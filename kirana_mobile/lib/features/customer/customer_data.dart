import 'dart:math';

import '../../core/api/api_client.dart';
import '../../core/models.dart';

/// Customer-module parsers and lightweight view models.
///
/// The v2 backend sends a few shapes the shared core models do not fully
/// capture (numeric `available` stock, `grand_total_minor` bills, slot
/// `remaining`/`slot_date`). These helpers adapt the raw JSON without touching
/// core, so every screen renders real data safely.

int _i(dynamic v) => v is int ? v : (v is num ? v.toInt() : int.tryParse('$v') ?? 0);
double _d(dynamic v) => v is num ? v.toDouble() : double.tryParse('$v') ?? 0.0;
String _s(dynamic v) => v == null ? '' : '$v';

/// Product parser that treats `available` as the numeric stock count the
/// backend actually sends (core treats it as a bool).
Product parseProduct(Map<String, dynamic> j) {
  final p = Product.fromJson(j);
  final avail = j['available'];
  if (avail is! num) return p;
  final stock = avail.toInt();
  return Product(
    id: p.id, storeId: p.storeId, categoryId: p.categoryId, name: p.name,
    brand: p.brand, unit: p.unit, description: p.description, imageUrl: p.imageUrl,
    mrpMinor: p.mrpMinor, priceMinor: p.priceMinor, discountPercent: p.discountPercent,
    maxPerOrder: p.maxPerOrder, available: stock > 0, active: p.active, stock: stock,
  );
}

/// Cart parser. Also reports lines whose price changed since they were added.
Cart parseCart(Map<String, dynamic> j, {Set<String>? priceChangedIds}) {
  final cart = Cart.fromJson(j);
  final rawItems = (j['items'] is List ? j['items'] as List : []).whereType<Map>().toList();
  final fixed = <CartItem>[];
  for (var i = 0; i < cart.items.length; i++) {
    final it = cart.items[i];
    final raw = i < rawItems.length ? Map<String, dynamic>.from(rawItems[i]) : <String, dynamic>{};
    if (priceChangedIds != null && raw['price_changed'] == true) priceChangedIds.add(it.productId);
    final avail = raw['available'];
    fixed.add(avail is num
        ? CartItem(
            productId: it.productId, name: it.name, unit: it.unit, imageUrl: it.imageUrl,
            quantity: it.quantity, priceMinor: it.priceMinor, mrpMinor: it.mrpMinor,
            lineTotalMinor: it.lineTotalMinor, available: avail > 0,
          )
        : it);
  }
  return Cart(storeId: cart.storeId, items: fixed, itemsTotalMinor: cart.itemsTotalMinor, savingsMinor: cart.savingsMinor);
}

int cartQtyOf(Cart? cart, String productId) {
  if (cart == null) return 0;
  for (final it in cart.items) {
    if (it.productId == productId) return it.quantity;
  }
  return 0;
}

/// Bill view matching POST /cart/quote and order `bill` payloads
/// (`grand_total_minor`, `coupon_discount_minor`, tip, free-delivery hints).
class BillView {
  final int itemsTotalMinor, savingsMinor, deliveryFeeMinor, handlingFeeMinor,
      surgeFeeMinor, couponDiscountMinor, tipMinor, grandTotalMinor, codDueMinor,
      amountToFreeDeliveryMinor;
  final bool deliveryFeeWaived;
  final String couponCode;
  const BillView({
    this.itemsTotalMinor = 0, this.savingsMinor = 0, this.deliveryFeeMinor = 0,
    this.handlingFeeMinor = 0, this.surgeFeeMinor = 0, this.couponDiscountMinor = 0,
    this.tipMinor = 0, this.grandTotalMinor = 0, this.codDueMinor = 0,
    this.amountToFreeDeliveryMinor = 0, this.deliveryFeeWaived = false, this.couponCode = '',
  });
  factory BillView.fromJson(Map<String, dynamic> j) => BillView(
        itemsTotalMinor: _i(j['items_total_minor']),
        savingsMinor: _i(j['savings_minor']),
        deliveryFeeMinor: _i(j['delivery_fee_minor']),
        handlingFeeMinor: _i(j['handling_fee_minor']),
        surgeFeeMinor: _i(j['surge_fee_minor']),
        couponDiscountMinor: _i(j['coupon_discount_minor'] ?? j['discount_minor']),
        tipMinor: _i(j['tip_minor']),
        grandTotalMinor: _i(j['grand_total_minor'] ?? j['total_minor']),
        codDueMinor: _i(j['cod_due_minor']),
        amountToFreeDeliveryMinor: _i(j['amount_to_free_delivery_minor']),
        deliveryFeeWaived: j['delivery_fee_waived'] == true,
        couponCode: _s(j['coupon_code']),
      );
  int get totalSavingsMinor => savingsMinor + couponDiscountMinor;
}

/// Delivery slot as returned by GET /stores/:id/delivery-slots
/// (`slot_date`, `remaining`).
class SlotView {
  final String id, date, startsAt, endsAt, label;
  final int capacity, remaining;
  const SlotView({
    required this.id, this.date = '', this.startsAt = '', this.endsAt = '',
    this.label = '', this.capacity = 0, this.remaining = 0,
  });
  factory SlotView.fromJson(Map<String, dynamic> j) => SlotView(
        id: _s(j['id']),
        date: _s(j['slot_date'] ?? j['date']),
        startsAt: _s(j['starts_at']),
        endsAt: _s(j['ends_at']),
        label: _s(j['label']),
        capacity: _i(j['capacity']),
        remaining: _i(j['remaining'] ?? (_i(j['capacity']) - _i(j['booked']))),
      );
  bool get bookable => remaining > 0;
}

/// POST /serviceability result.
class ServiceInfo {
  final bool serviceable;
  final int etaMinutes;
  final double distanceKm;
  final String promise, message;
  const ServiceInfo({
    this.serviceable = false, this.etaMinutes = 0, this.distanceKm = 0,
    this.promise = '', this.message = '',
  });
  factory ServiceInfo.fromJson(Map<String, dynamic> j) => ServiceInfo(
        serviceable: j['serviceable'] == true,
        etaMinutes: _i(j['eta_minutes']),
        distanceKm: _d(j['distance_km']),
        promise: _s(j['promise']),
        message: _s(j['message']),
      );
}

/// Shared cart → checkout selections (coupon, delivery type, slot, tip).
class CheckoutDraft {
  final String couponCode;
  final String deliveryType; // 'instant' | 'scheduled'
  final String slotId, slotLabel;
  final int tipMinor;
  const CheckoutDraft({
    this.couponCode = '', this.deliveryType = 'instant',
    this.slotId = '', this.slotLabel = '', this.tipMinor = 0,
  });
  bool get isScheduled => deliveryType == 'scheduled';
  CheckoutDraft copyWith({
    String? couponCode, String? deliveryType, String? slotId, String? slotLabel, int? tipMinor,
  }) => CheckoutDraft(
        couponCode: couponCode ?? this.couponCode,
        deliveryType: deliveryType ?? this.deliveryType,
        slotId: slotId ?? this.slotId,
        slotLabel: slotLabel ?? this.slotLabel,
        tipMinor: tipMinor ?? this.tipMinor,
      );
}

class NotificationItem {
  final String id, kind, title, body, orderId, createdAt;
  final bool read;
  const NotificationItem({
    required this.id, this.kind = '', this.title = '', this.body = '',
    this.orderId = '', this.createdAt = '', this.read = false,
  });
  factory NotificationItem.fromJson(Map<String, dynamic> j) => NotificationItem(
        id: _s(j['id']), kind: _s(j['kind']), title: _s(j['title']), body: _s(j['body']),
        orderId: _s(j['order_id']), createdAt: _s(j['created_at']),
        read: j['read'] == true || j['read_at'] != null,
      );
  NotificationItem asRead() => NotificationItem(
        id: id, kind: kind, title: title, body: body,
        orderId: orderId, createdAt: createdAt, read: true,
      );
}

/// Idempotency key for checkout: 48 url-safe hex chars (16–128 required).
String newIdempotencyKey() {
  final rng = Random.secure();
  final bytes = List<int>.generate(24, (_) => rng.nextInt(256));
  return bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
}

/// Order helpers reading fields the core [Order] keeps only in `raw`.
int orderEtaMinutes(Order order) {
  final live = order.raw['eta_live_minutes'];
  final promise = order.raw['eta_promise_minutes'];
  return _i(live ?? promise);
}

int? orderRating(Order order) {
  final r = order.raw['rating'];
  return r is num ? r.toInt() : null;
}

String orderOtp(Order order) => _s(order.raw['delivery_otp']);

BillView orderBill(Order order) => BillView.fromJson(mapFrom(order.raw['bill']));

Map<String, dynamic> orderAddress(Order order) => mapFrom(order.raw['address']);

Map<String, dynamic> orderSlot(Order order) => mapFrom(order.raw['slot']);

Rider? orderRider(Order order) {
  final r = order.raw['rider'];
  return r is Map ? Rider.fromJson(Map<String, dynamic>.from(r)) : null;
}

int orderItemLineTotal(Map<String, dynamic> item) =>
    _i(item['line_total_minor'] ?? (_i(item['price_minor']) * _i(item['quantity'])));