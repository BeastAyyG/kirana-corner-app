// Admin order detail: full bill, items, drop info, rider, pickup code and the
// event timeline. Fetches the authoritative order view; admins are allowed on
// GET /orders/:id and receive customer + pickup_code extras.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/api/api_client.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'admin_actions.dart';
import 'admin_models.dart';
import 'admin_shared.dart';

class OrderDetailScreen extends ConsumerStatefulWidget {
  final String orderId;
  final Order? initial;
  const OrderDetailScreen({super.key, required this.orderId, this.initial});
  @override
  ConsumerState<OrderDetailScreen> createState() => _OrderDetailScreenState();
}

class _OrderDetailScreenState extends ConsumerState<OrderDetailScreen> {
  Order? _order;
  Object? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _order = widget.initial;
    _loading = widget.initial == null;
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await ref.read(apiProvider).order(widget.orderId);
      final order = Order.fromJson(mapFrom(data, 'order'));
      if (!mounted) return;
      setState(() {
        _order = order;
        _error = null;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  Future<void> _cancel() async {
    final order = _order;
    if (order == null) return;
    final cancelled = await adminCancelOrderFlow(context, ref, order);
    if (cancelled) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final order = _order;
    return Scaffold(
      appBar: AppBar(
        title: Text(order == null ? 'Order' : 'Order ${order.publicLabel.isEmpty ? order.id : order.publicLabel}'),
        actions: [RefreshAction(onPressed: _load)],
      ),
      body: _loading && order == null
          ? const LoadingView()
          : order == null
              ? ErrorView(message: adminErrorMessage(_error ?? 'Could not load the order'), onRetry: _load)
              : _DetailBody(order: order, onCancel: _cancel),
    );
  }
}

class _DetailBody extends StatelessWidget {
  final Order order;
  final VoidCallback onCancel;
  const _DetailBody({required this.order, required this.onCancel});

  @override
  Widget build(BuildContext context) {
    final raw = order.raw;
    final customer = rawMap(raw['customer']);
    final address = rawMap(raw['address']);
    final rider = rawMap(raw['rider']);
    final bill = rawMap(raw['bill']);
    final events = rawList(raw['events']);
    final pickupCode = rawString(raw['pickup_code']);
    final live = isLive(order.status);
    final addressLine = [
      rawString(address['line1']),
      rawString(address['line2']),
      rawString(address['landmark']),
      rawString(address['city']),
      rawString(address['pincode']),
    ].where((s) => s.isNotEmpty).join(', ');

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
      children: [
        Wrap(spacing: 6, runSpacing: 6, children: [
          StatusChip(status: order.status),
          Pill(
            label: order.deliveryType == 'scheduled' ? 'Scheduled' : 'Instant',
            bg: order.deliveryType == 'scheduled' ? BB.blueTint : BB.greenTint,
            fg: order.deliveryType == 'scheduled' ? BB.blue : BB.greenDeep,
          ),
          Pill(label: order.paymentMethod == 'cod' ? 'COD' : 'Online', bg: BB.blueTint, fg: BB.blue),
          Pill(label: order.paymentStatus.isEmpty ? 'payment —' : order.paymentStatus, bg: BB.amberTint, fg: BB.amber),
        ]),
        const SizedBox(height: 12),
        AppCard(
          child: Column(children: [
            if (customer.isNotEmpty)
              InfoRow(label: 'Customer', value: '${rawString(customer['name']).isEmpty ? 'Guest' : rawString(customer['name'])} · ${phonePretty(rawString(customer['phone']))}'),
            InfoRow(label: 'Store', value: order.store?.name ?? '—'),
            InfoRow(label: 'Placed', value: dateTime(rawString(raw['placed_at']).isEmpty ? order.createdAt : rawString(raw['placed_at']))),
            InfoRow(label: order.deliveryType == 'scheduled' ? 'Slot' : 'ETA', value: _slotLine(raw)),
            if (raw['distance_km'] != null) InfoRow(label: 'Distance', value: distanceLabel(raw['distance_km'] as num?)),
            InfoRow(label: 'Deliver to', value: '${rawString(address['receiver_name'])}${addressLine.isEmpty ? '' : ' · $addressLine'}'.trim()),
            if (rawString(raw['delivery_instructions']).isNotEmpty)
              InfoRow(label: 'Instructions', value: rawString(raw['delivery_instructions'])),
            if (order.status == 'cancelled') InfoRow(label: 'Cancel reason', value: rawString(raw['cancel_reason']).isEmpty ? '—' : rawString(raw['cancel_reason'])),
            if (rawInt(raw['rating']) > 0)
              InfoRow(label: 'Rating', value: '${rawInt(raw['rating'])}/5${rawString(raw['rating_comment']).isEmpty ? '' : ' · ${rawString(raw['rating_comment'])}'}'),
          ]),
        ),
        if (pickupCode.isNotEmpty && live) ...[
          const SizedBox(height: 12),
          AppCard(
            child: Column(children: [
              const Text('Store pickup code', style: TextStyle(fontSize: 11.5, color: BB.sub, fontWeight: FontWeight.w600)),
              const SizedBox(height: 4),
              Text(prettyCode(pickupCode), style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800, letterSpacing: 3, color: BB.greenDeep)),
              const SizedBox(height: 4),
              const Text('The rider collects this order with this code', style: TextStyle(fontSize: 11, color: BB.faint)),
            ]),
          ),
        ],
        const SectionHeader(title: 'Items'),
        AppCard(
          child: Column(children: [
            for (final item in order.items) _ItemLine(item: item),
          ]),
        ),
        const SectionHeader(title: 'Bill'),
        AppCard(
          child: Column(children: [
            InfoRow(label: 'Items total', value: money(rawInt(bill['items_total_minor']))),
            if (rawInt(bill['savings_minor']) > 0)
              InfoRow(label: 'Savings', value: '−${money(rawInt(bill['savings_minor']))}', valueColor: BB.saveInk),
            InfoRow(label: 'Delivery fee', value: money(rawInt(bill['delivery_fee_minor']))),
            if (rawInt(bill['handling_fee_minor']) > 0) InfoRow(label: 'Handling fee', value: money(rawInt(bill['handling_fee_minor']))),
            if (rawInt(bill['surge_fee_minor']) > 0) InfoRow(label: 'Surge fee', value: money(rawInt(bill['surge_fee_minor']))),
            if (rawInt(bill['tip_minor']) > 0) InfoRow(label: 'Rider tip', value: money(rawInt(bill['tip_minor']))),
            if (rawInt(bill['coupon_discount_minor']) > 0)
              InfoRow(label: 'Coupon${order.couponCode.isEmpty ? '' : ' (${order.couponCode})'}', value: '−${money(rawInt(bill['coupon_discount_minor']))}', valueColor: BB.saveInk),
            const Divider(height: 18),
            InfoRow(label: 'Grand total', value: money(orderTotalMinor(order)), bold: true),
            if (order.paymentMethod == 'cod' && rawInt(bill['cod_due_minor']) > 0)
              InfoRow(label: 'Cash due on delivery', value: money(rawInt(bill['cod_due_minor'])), bold: true),
          ]),
        ),
        if (rider.isNotEmpty) ...[
          const SectionHeader(title: 'Rider'),
          AppCard(
            child: Row(children: [
              Container(
                width: 40,
                height: 40,
                decoration: const BoxDecoration(color: BB.greenTint, shape: BoxShape.circle),
                alignment: Alignment.center,
                child: Text(
                  rawString(rider['name']).isEmpty ? 'R' : rawString(rider['name']).substring(0, 1).toUpperCase(),
                  style: const TextStyle(fontWeight: FontWeight.w800, color: BB.greenDeep),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(rawString(rider['name']).isEmpty ? 'Rider' : rawString(rider['name']), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5, color: BB.ink)),
                  const SizedBox(height: 3),
                  Wrap(spacing: 4, children: [
                    Pill(label: rawString(rider['vehicle']).isEmpty ? 'bike' : rawString(rider['vehicle'])),
                    Pill(label: phonePretty(rawString(rider['phone'])), bg: BB.line, fg: BB.sub),
                  ]),
                ]),
              ),
              if (rawString(rider['phone']).isNotEmpty)
                IconButton(
                  onPressed: () => launchUrl(Uri.parse('tel:${rawString(rider['phone'])}')),
                  icon: const Icon(Icons.call_rounded, color: BB.greenDark),
                  tooltip: 'Call rider',
                ),
            ]),
          ),
        ],
        if (events.isNotEmpty) ...[
          const SectionHeader(title: 'Progress'),
          AppCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              for (final event in events)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 5),
                  child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    const Padding(
                      padding: EdgeInsets.only(top: 5),
                      child: Icon(Icons.circle, size: 7, color: BB.green),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(statusText(rawString(event['status'])), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: BB.ink)),
                        if (rawString(event['note']).isNotEmpty)
                          Text(rawString(event['note']), style: const TextStyle(fontSize: 11.5, color: BB.sub)),
                      ]),
                    ),
                    Text(dateTime(rawString(event['created_at'])), style: const TextStyle(fontSize: 10.5, color: BB.faint)),
                  ]),
                ),
            ]),
          ),
        ],
        if (live) ...[
          const SizedBox(height: 18),
          SizedBox(
            width: double.infinity,
            height: 48,
            child: OutlinedButton.icon(
              onPressed: onCancel,
              style: OutlinedButton.styleFrom(foregroundColor: BB.red, side: const BorderSide(color: BB.red)),
              icon: const Icon(Icons.close_rounded, size: 18),
              label: const Text('Cancel this order'),
            ),
          ),
        ],
      ],
    );
  }

  String _slotLine(Map<String, dynamic> raw) {
    final slot = rawMap(raw['slot']);
    final slotDate = rawString(slot['slot_date']);
    if (order.deliveryType == 'scheduled' && slotDate.isNotEmpty) {
      return '${dateLabel(slotDate)} · ${slotRange(rawString(slot['starts_at']), rawString(slot['ends_at']))}';
    }
    final mins = raw['eta_live_minutes'] ?? raw['eta_promise_minutes'];
    return mins == null ? 'Instant' : 'Instant · ${rawInt(mins)} min';
  }
}

class _ItemLine extends StatelessWidget {
  final Map<String, dynamic> item;
  const _ItemLine({required this.item});

  @override
  Widget build(BuildContext context) {
    final qty = rawInt(item['quantity']);
    final picked = item['picked_quantity'];
    final refunded = rawInt(item['refunded_minor']);
    final brand = rawString(item['brand']);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(rawString(item['name']), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: BB.ink)),
            const SizedBox(height: 2),
            Text('${brand.isEmpty ? '' : '$brand · '}${rawString(item['unit'])} × $qty', style: const TextStyle(fontSize: 11.5, color: BB.sub)),
            if (picked != null)
              Text('Picked ${rawInt(picked)}/$qty', style: const TextStyle(fontSize: 11, color: BB.blue, fontWeight: FontWeight.w600)),
            if (refunded > 0)
              Text('Refunded ${money(refunded)}', style: const TextStyle(fontSize: 11, color: BB.red, fontWeight: FontWeight.w600)),
          ]),
        ),
        Text(money(rawInt(item['price_minor']) * qty), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: BB.ink)),
      ]),
    );
  }
}