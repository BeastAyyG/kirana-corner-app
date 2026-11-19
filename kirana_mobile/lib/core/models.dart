// Typed models for the v2 API. Money is integer paise (*_minor).
// Parsers are defensive: missing keys fall back to safe defaults.
int _i(dynamic v) => v is int ? v : (v is num ? v.toInt() : int.tryParse('$v') ?? 0);
double _d(dynamic v) => v is num ? v.toDouble() : double.tryParse('$v') ?? 0.0;
String _s(dynamic v) => v == null ? '' : '$v';
bool _b(dynamic v) => v == true || v == 1 || v == '1' || v == 'true';
Map<String, dynamic> _m(dynamic v) => v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};

class Category {
  final String id, name;
  final int sortOrder;
  Category({required this.id, required this.name, this.sortOrder = 0});
  factory Category.fromJson(Map<String, dynamic> j) =>
      Category(id: _s(j['id']), name: _s(j['name']), sortOrder: _i(j['sort_order']));
}

class Store {
  final String id, name, address, city, pincode;
  final double lat, lng, radiusKm, distanceKm;
  final bool isOpen, acceptingOrders, surgeActive;
  final int prepTimeMinutes, minOrderMinor, deliveryBaseFeeMinor, deliveryPerKmMinor,
      freeDeliveryAboveMinor, handlingFeeMinor, surgeFeeMinor;
  Store({
    required this.id, required this.name, this.address = '', this.city = '', this.pincode = '',
    this.lat = 0, this.lng = 0, this.radiusKm = 0, this.distanceKm = 0,
    this.isOpen = true, this.acceptingOrders = true, this.surgeActive = false,
    this.prepTimeMinutes = 0, this.minOrderMinor = 0, this.deliveryBaseFeeMinor = 0,
    this.deliveryPerKmMinor = 0, this.freeDeliveryAboveMinor = 0, this.handlingFeeMinor = 0, this.surgeFeeMinor = 0,
  });
  factory Store.fromJson(Map<String, dynamic> j) => Store(
        id: _s(j['id']), name: _s(j['name']), address: _s(j['address']), city: _s(j['city']), pincode: _s(j['pincode']),
        lat: _d(j['lat']), lng: _d(j['lng']), radiusKm: _d(j['radius_km']), distanceKm: _d(j['distance_km']),
        isOpen: _b(j['is_open']), acceptingOrders: _b(j['accepting_orders']), surgeActive: _b(j['surge_active']),
        prepTimeMinutes: _i(j['prep_time_minutes']), minOrderMinor: _i(j['min_order_minor']),
        deliveryBaseFeeMinor: _i(j['delivery_base_fee_minor']), deliveryPerKmMinor: _i(j['delivery_per_km_minor']),
        freeDeliveryAboveMinor: _i(j['free_delivery_above_minor']), handlingFeeMinor: _i(j['handling_fee_minor']),
        surgeFeeMinor: _i(j['surge_fee_minor']),
      );
}

class Product {
  final String id, storeId, categoryId, name, brand, unit, description, imageUrl;
  final int mrpMinor, priceMinor, discountPercent, maxPerOrder;
  final bool available, active;
  final int stock;
  Product({
    required this.id, this.storeId = '', this.categoryId = '', required this.name,
    this.brand = '', this.unit = '', this.description = '', this.imageUrl = '',
    this.mrpMinor = 0, this.priceMinor = 0, this.discountPercent = 0, this.maxPerOrder = 0,
    this.available = true, this.active = true, this.stock = 0,
  });
  factory Product.fromJson(Map<String, dynamic> j) => Product(
        id: _s(j['id']), storeId: _s(j['store_id']), categoryId: _s(j['category_id']), name: _s(j['name']),
        brand: _s(j['brand']), unit: _s(j['unit']), description: _s(j['description']), imageUrl: _s(j['image_url']),
        mrpMinor: _i(j['mrp_minor']), priceMinor: _i(j['price_minor']), discountPercent: _i(j['discount_percent']),
        maxPerOrder: _i(j['max_per_order']), available: j.containsKey('available') ? _b(j['available']) : true,
        active: j.containsKey('active') ? _b(j['active']) : true,
        stock: _i(j['stock'] ?? j['quantity'] ?? j['stock_quantity']),
      );
  // For ArtImage fallback lookups.
  Map<String, dynamic> get artItem => {'id': id, 'category_id': categoryId, 'image_url': imageUrl};
}

class CartItem {
  final String productId, name, unit, imageUrl;
  final int quantity, priceMinor, mrpMinor, lineTotalMinor;
  final bool available;
  CartItem({
    required this.productId, this.name = '', this.unit = '', this.imageUrl = '',
    this.quantity = 0, this.priceMinor = 0, this.mrpMinor = 0, this.lineTotalMinor = 0, this.available = true,
  });
  factory CartItem.fromJson(Map<String, dynamic> j) => CartItem(
        productId: _s(j['product_id'] ?? j['id']), name: _s(j['name']), unit: _s(j['unit']), imageUrl: _s(j['image_url']),
        quantity: _i(j['quantity']), priceMinor: _i(j['price_minor']), mrpMinor: _i(j['mrp_minor']),
        lineTotalMinor: _i(j['line_total_minor'] ?? j['total_minor']), available: j.containsKey('available') ? _b(j['available']) : true,
      );
}

class Cart {
  final String storeId;
  final List<CartItem> items;
  final int itemsTotalMinor, savingsMinor;
  Cart({this.storeId = '', this.items = const [], this.itemsTotalMinor = 0, this.savingsMinor = 0});
  factory Cart.fromJson(Map<String, dynamic> j) => Cart(
        storeId: _s(j['store_id']),
        items: (j['items'] is List ? (j['items'] as List) : []).whereType<Map>().map((e) => CartItem.fromJson(Map<String, dynamic>.from(e))).toList(),
        itemsTotalMinor: _i(j['items_total_minor']), savingsMinor: _i(j['savings_minor']),
      );
  int get count => items.fold(0, (a, b) => a + b.quantity);
  bool get isEmpty => items.isEmpty;
}

class Address {
  final String id, label, receiverName, receiverPhone, line1, line2, landmark, city, pincode;
  final double lat, lng;
  final bool isDefault;
  Address({
    required this.id, this.label = '', this.receiverName = '', this.receiverPhone = '',
    this.line1 = '', this.line2 = '', this.landmark = '', this.city = '', this.pincode = '',
    this.lat = 0, this.lng = 0, this.isDefault = false,
  });
  factory Address.fromJson(Map<String, dynamic> j) => Address(
        id: _s(j['id']), label: _s(j['label']), receiverName: _s(j['receiver_name']), receiverPhone: _s(j['receiver_phone']),
        line1: _s(j['line1']), line2: _s(j['line2']), landmark: _s(j['landmark']), city: _s(j['city']), pincode: _s(j['pincode']),
        lat: _d(j['lat']), lng: _d(j['lng']), isDefault: _b(j['is_default']),
      );
  String get full => [line1, line2, landmark, city, pincode].where((s) => s.isNotEmpty).join(', ');
}

class DeliverySlot {
  final String id, date;
  final String startsAt, endsAt;
  final int capacity, booked;
  final bool available;
  DeliverySlot({required this.id, this.date = '', this.startsAt = '', this.endsAt = '', this.capacity = 0, this.booked = 0, this.available = true});
  factory DeliverySlot.fromJson(Map<String, dynamic> j) => DeliverySlot(
        id: _s(j['id']), date: _s(j['date']), startsAt: _s(j['starts_at']), endsAt: _s(j['ends_at']),
        capacity: _i(j['capacity']), booked: _i(j['booked']), available: j.containsKey('available') ? _b(j['available']) : true,
      );
}

class Coupon {
  final String id, code, description;
  final String type;
  final int valueMinor, minOrderMinor, maxDiscountMinor;
  final bool active;
  Coupon({required this.id, required this.code, this.description = '', this.type = 'flat', this.valueMinor = 0, this.minOrderMinor = 0, this.maxDiscountMinor = 0, this.active = true});
  factory Coupon.fromJson(Map<String, dynamic> j) => Coupon(
        id: _s(j['id']), code: _s(j['code']), description: _s(j['description']), type: _s(j['type'] ?? 'flat'),
        valueMinor: _i(j['value'] ?? j['value_minor'] ?? j['discount_minor']), minOrderMinor: _i(j['min_order_minor']),
        maxDiscountMinor: _i(j['max_discount_minor']), active: j.containsKey('active') ? _b(j['active']) : true,
      );
}

class OrderBill {
  final int itemsTotalMinor, deliveryFeeMinor, handlingFeeMinor, surgeFeeMinor, tipMinor, discountMinor, totalMinor, codDueMinor, savingsMinor;
  OrderBill({this.itemsTotalMinor = 0, this.deliveryFeeMinor = 0, this.handlingFeeMinor = 0, this.surgeFeeMinor = 0, this.tipMinor = 0, this.discountMinor = 0, this.totalMinor = 0, this.codDueMinor = 0, this.savingsMinor = 0});
  factory OrderBill.fromJson(Map<String, dynamic> j) => OrderBill(
        itemsTotalMinor: _i(j['items_total_minor']), deliveryFeeMinor: _i(j['delivery_fee_minor']),
        handlingFeeMinor: _i(j['handling_fee_minor']), surgeFeeMinor: _i(j['surge_fee_minor']),
        tipMinor: _i(j['tip_minor']),
        discountMinor: _i(j['coupon_discount_minor'] ?? j['discount_minor']),
        totalMinor: _i(j['grand_total_minor'] ?? j['total_minor']),
        codDueMinor: _i(j['cod_due_minor']), savingsMinor: _i(j['savings_minor']),
      );
}

class Order {
  final String id, publicLabel, status, deliveryType, slotId, paymentMethod, paymentStatus, createdAt, couponCode;
  final Store? store;
  final OrderBill bill;
  final List<Map<String, dynamic>> items;
  final Map<String, dynamic> raw;
  Order({
    required this.id, this.publicLabel = '', this.status = '', this.deliveryType = '', this.slotId = '',
    this.paymentMethod = '', this.paymentStatus = '', this.createdAt = '', this.couponCode = '',
    this.store, required this.bill, this.items = const [], this.raw = const {},
  });
  factory Order.fromJson(Map<String, dynamic> j) => Order(
        id: _s(j['id']), publicLabel: _s(j['public_label']), status: _s(j['status']), deliveryType: _s(j['delivery_type']),
        slotId: _s(j['slot_id']), paymentMethod: _s(j['payment_method']), paymentStatus: _s(j['payment_status']),
        createdAt: _s(j['created_at']), couponCode: _s(j['coupon_code']),
        store: j['store'] is Map ? Store.fromJson(_m(j['store'])) : null,
        bill: OrderBill.fromJson(_m(j['bill'])),
        items: (j['items'] is List ? (j['items'] as List) : []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList(),
        raw: j,
      );
}

class Rider {
  final String id, name, phone, vehicle, homeStoreId;
  final bool isOnline;
  final double lat, lng;
  Rider({required this.id, this.name = '', this.phone = '', this.vehicle = '', this.homeStoreId = '', this.isOnline = false, this.lat = 0, this.lng = 0});
  factory Rider.fromJson(Map<String, dynamic> j) {
    final loc = _m(j['location']);
    return Rider(
      id: _s(j['id']), name: _s(j['name']), phone: _s(j['phone']), vehicle: _s(j['vehicle']),
      homeStoreId: _s(j['home_store_id']), isOnline: _b(j['is_online']), lat: _d(loc['lat']), lng: _d(loc['lng']),
    );
  }
}

class Job {
  final String id, orderId, publicLabel, status, orderStatus, paymentMethod;
  final int payoutMinor, tipMinor, cashToCollectMinor;
  final bool cashCollected;
  final Map<String, dynamic> store, drop;
  final Map<String, dynamic> raw;
  Job({
    required this.id, this.orderId = '', this.publicLabel = '', this.status = '', this.orderStatus = '', this.paymentMethod = '',
    this.payoutMinor = 0, this.tipMinor = 0, this.cashToCollectMinor = 0, this.cashCollected = false,
    this.store = const {}, this.drop = const {}, this.raw = const {},
  });
  factory Job.fromJson(Map<String, dynamic> j) => Job(
        id: _s(j['id']), orderId: _s(j['order_id']), publicLabel: _s(j['public_label']), status: _s(j['status']),
        orderStatus: _s(j['order_status']), paymentMethod: _s(j['payment_method']), payoutMinor: _i(j['payout_minor']),
        tipMinor: _i(j['tip_minor']), cashToCollectMinor: _i(j['cash_to_collect_minor']), cashCollected: _b(j['cash_collected']),
        store: _m(j['store']), drop: _m(j['drop']), raw: j,
      );
}

class AppUser {
  final String id, name, phone, role;
  final bool active;
  AppUser({required this.id, this.name = '', this.phone = '', this.role = '', this.active = true});
  factory AppUser.fromJson(Map<String, dynamic> j) => AppUser(
        id: _s(j['id']), name: _s(j['name']), phone: _s(j['phone']), role: _s(j['role']),
        active: j.containsKey('active') ? _b(j['active']) : true,
      );
}