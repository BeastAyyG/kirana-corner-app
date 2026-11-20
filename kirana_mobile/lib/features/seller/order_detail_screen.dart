import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api/api_client.dart';
import '../../core/art.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'seller_common.dart';
import 'seller_providers.dart';

const _pollInterval = Duration(seconds: 15);

/// Pick & pack detail: customer / payment summary, pickup code, aisle-guided
/// pick list with steppers and short picks, bill summary and the
/// start-packing → mark-ready flow. Polls while the order is live.
class OrderDetailScreen extends ConsumerStatefulWidget {
  final String storeId;
  final String orderId;
  const OrderDetailScreen({super.key, required this.storeId, required this.orderId});
  @override
  ConsumerState<OrderDetailScreen> createState() => _OrderDetailScreenState();
}

class _OrderDetailScreenState extends ConsumerState<OrderDetailScreen> {
  Order? _order;
  bool _loading = true;
  String _error = '';
  bool _actionBusy = false;
  final Set<int> _busyItems = {};
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _load();
    _poll = Timer.periodic(_pollInterval, (_) {
      final o = _order;
      if (o != null && isLive(o.status)) _refetch();
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = '';
    });
    try {
      final data = await ref.read(apiProvider).storeOrder(widget.storeId, widget.orderId);
      if (!mounted) return;
      setState(() {
        _order = Order.fromJson(mapFrom(data, 'order'));
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = errorMessage(e);
        _loading = false;
      });
    }
  }

  Future<void> _refetch() async {
    try {
      final data = await ref.read(apiProvider).storeOrder(widget.storeId, widget.orderId);
      if (!mounted) return;
      setState(() => _order = Order.fromJson(mapFrom(data, 'order')));
    } catch (_) {
      // Keep the last good view on transient failures.
    }
  }

  void _adoptOrder(dynamic data) {
    final raw = mapFrom(data, 'order');
    if (raw.isEmpty || !mounted) return;
    setState(() => _order = Order.fromJson(raw));
  }

  Future<void> _startPacking() async {
    if (_actionBusy) return;
    setState(() => _actionBusy = true);
    try {
      final data = await ref.read(apiProvider).startPacking(widget.orderId);
      if (!mounted) return;
      _adoptOrder(data);
      showSnack(context, 'Packing started — pick each item');
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _actionBusy = false);
    }
  }

  Future<void> _pick(Map<String, dynamic> item, int quantity) async {
    final id = intOf(item['id']);
    if (_busyItems.contains(id)) return;
    setState(() => _busyItems.add(id));
    try {
      final data = await ref.read(apiProvider).pickItem(widget.orderId, '$id', quantity);
      if (!mounted) return;
      _adoptOrder(data);
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _busyItems.remove(id));
    }
  }

  Future<void> _openShortDialog(Map<String, dynamic> item) async {
    final qty = intOf(item['quantity']);
    final controller = TextEditingController(text: '${intOrNull(item['picked_quantity']) ?? (qty - 1).clamp(0, qty)}');
    final picked = await showDialog<int>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: BB.card,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(BB.radiusLg)),
        title: Text('Short pick — ${strOf(item['name'])}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Ordered ×$qty. Missing units are auto-refunded when you mark the order ready.',
              style: const TextStyle(fontSize: 13, color: BB.sub)),
          const SizedBox(height: 14),
          TextField(
            controller: controller,
            autofocus: true,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(labelText: 'Picked quantity (0–${qty - 1})', isDense: true),
          ),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () {
              final v = int.tryParse(controller.text.trim());
              if (v == null || v < 0 || v >= qty) {
                showSnack(ctx, 'Enter a whole number between 0 and ${qty - 1}', error: true);
                return;
              }
              Navigator.of(ctx).pop(v);
            },
            child: const Text('Save pick'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (picked != null) await _pick(item, picked);
  }

  List<Map<String, dynamic>> _shortages(Order o) => o.items
      .where((it) => intOrNull(it['picked_quantity']) != null && intOf(it['picked_quantity']) < intOf(it['quantity']))
      .toList();

  int _refundTotal(Order o) => _shortages(o).fold<int>(
      0, (sum, it) => sum + (intOf(it['quantity']) - intOf(it['picked_quantity'])) * intOf(it['price_minor']));

  Future<void> _packOrder() async {
    final o = _order;
    if (o == null || _actionBusy) return;
    final shorts = _shortages(o);
    if (shorts.isNotEmpty) {
      final ok = await askConfirm(
        context,
        title: 'Pack with shortages?',
        message: '${shorts.length} item${shorts.length == 1 ? '' : 's'} short. '
            '${money(_refundTotal(o))} will be refunded to the customer automatically.',
        confirmLabel: 'Mark ready',
      );
      if (!ok || !mounted) return;
    }
    setState(() => _actionBusy = true);
    try {
      await ref.read(apiProvider).packOrder(widget.orderId);
      if (!mounted) return;
      ref.invalidate(queueProvider(widget.storeId));
      showSnack(context, shorts.isNotEmpty
          ? 'Packed with shortages · ${money(_refundTotal(o))} refunded'
          : 'Order packed — dispatching a rider');
      Navigator.of(context).pop();
    } catch (e) {
      if (mounted) {
        setState(() => _actionBusy = false);
        showSnack(context, errorMessage(e), error: true);
      }
    }
  }

  Future<void> _call(String phone) async {
    if (phone.isEmpty) return;
    try {
      await launchUrl(Uri.parse('tel:$phone'), mode: LaunchMode.externalApplication);
    } catch (_) {
      if (mounted) showSnack(context, 'Could not open the dialer', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final o = _order;
    return Scaffold(
      appBar: AppBar(
        title: Text(o == null ? 'Order' : prettyCode(o.publicLabel.isNotEmpty ? o.publicLabel : o.id)),
        actions: [if (o != null) Padding(padding: const EdgeInsets.only(right: 16), child: StatusChip(status: o.status))],
      ),
      body: _loading
          ? const LoadingView()
          : _error.isNotEmpty && o == null
              ? ErrorView(message: _error, onRetry: _load)
              : o == null
                  ? const EmptyState(icon: Icons.receipt_long_outlined, title: 'Order not found')
                  : _body(o),
      bottomNavigationBar: o == null || _loading ? null : _cta(o),
    );
  }

  Widget _body(Order o) {
    final totalQty = o.items.fold<int>(0, (n, it) => n + intOf(it['quantity']));
    final done = o.items.where((it) => intOrNull(it['picked_quantity']) != null).length;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
      children: [
        _summary(o),
        if (isLive(o.status) && strOf(o.raw['pickup_code']).isNotEmpty) ...[
          const SizedBox(height: 12),
          _pickupCode(strOf(o.raw['pickup_code'])),
        ],
        const SizedBox(height: 16),
        Row(children: [
          const Expanded(child: Text('Pick list', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: BB.ink))),
          Text('${o.items.length} lines · $totalQty units', style: const TextStyle(fontSize: 12, color: BB.sub)),
        ]),
        const SizedBox(height: 8),
        ClipRRect(
          borderRadius: BorderRadius.circular(6),
          child: LinearProgressIndicator(
            value: o.items.isEmpty ? 0 : done / o.items.length,
            minHeight: 8,
            backgroundColor: BB.line,
            color: BB.green,
          ),
        ),
        const SizedBox(height: 6),
        Text('$done/${o.items.length} picked', style: const TextStyle(fontSize: 12, color: BB.sub, fontWeight: FontWeight.w600)),
        if (o.status == 'packing' && _shortages(o).isNotEmpty) ...[
          const SizedBox(height: 10),
          _notice(
            Icons.warning_amber_rounded,
            BB.amberTint,
            BB.amber,
            '${_shortages(o).length} short pick${_shortages(o).length == 1 ? '' : 's'}: '
            '${_shortages(o).map((it) => '${strOf(it['name'])} (−${intOf(it['quantity']) - intOf(it['picked_quantity'])})').join(', ')}. '
            '${money(_refundTotal(o))} will be refunded when you mark ready.',
          ),
        ],
        const SizedBox(height: 10),
        for (final it in o.items) _pickRow(o, it),
        if (mapOf(o.raw['rider']).isNotEmpty && isLive(o.status)) ...[
          const SizedBox(height: 12),
          _riderCard(o),
        ],
        const SizedBox(height: 16),
        _bill(o),
      ],
    );
  }

  Widget _summary(Order o) {
    final customer = mapOf(o.raw['customer']);
    final address = mapOf(o.raw['address']);
    final phone = strOf(customer['phone']);
    final isCod = o.paymentMethod == 'cod';
    final slot = mapOf(o.raw['slot']);
    final eta = o.deliveryType == 'scheduled' && slot.isNotEmpty
        ? '${dateLabel(strOf(slot['slot_date']))} · ${slotRange(strOf(slot['starts_at']), strOf(slot['ends_at']))}'
        : '${intOrNull(o.raw['eta_promise_minutes']) ?? '—'} min promise';
    final addr = strOf(address['full_address']).isNotEmpty ? strOf(address['full_address']) : strOf(address['line1']);
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(strOf(customer['name']).isNotEmpty ? strOf(customer['name']) : 'Customer',
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: BB.ink)),
              if (phone.isNotEmpty) Text(phonePretty(phone), style: const TextStyle(fontSize: 12, color: BB.sub)),
            ]),
          ),
          if (phone.isNotEmpty)
            IconButton(
              onPressed: () => _call(phone),
              icon: const Icon(Icons.call, color: BB.greenDark, size: 20),
              tooltip: 'Call customer',
            ),
        ]),
        if (addr.isNotEmpty) ...[
          const SizedBox(height: 6),
          Text(addr, style: const TextStyle(fontSize: 12.5, color: BB.sub, height: 1.35)),
        ],
        const SizedBox(height: 10),
        Row(children: [
          const SizedBox(width: 90, child: Text('Payment', style: TextStyle(fontSize: 13, color: BB.sub))),
          Expanded(
            child: Wrap(spacing: 6, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
              isCod
                  ? Pill(label: 'COD · collect ${money(codDueOf(o))}', color: BB.amber, tint: BB.amberTint)
                  : const Pill(label: 'Paid online', color: BB.saveInk, tint: BB.saveTint),
              Text(o.paymentStatus, style: const TextStyle(fontSize: 11, color: BB.faint)),
            ]),
          ),
        ]),
        InfoRow(label: o.deliveryType == 'scheduled' ? 'Slot' : 'ETA', value: eta),
        InfoRow(label: 'Placed', value: dateTime(strOf(o.raw['placed_at']).isNotEmpty ? strOf(o.raw['placed_at']) : o.createdAt)),
        if (strOf(o.raw['delivery_instructions']).isNotEmpty)
          InfoRow(label: 'Instructions', value: strOf(o.raw['delivery_instructions'])),
      ]),
    );
  }

  Widget _pickupCode(String code) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: BB.greenTint,
          borderRadius: BorderRadius.circular(BB.radius),
          border: Border.all(color: BB.green.withValues(alpha: .4)),
        ),
        child: Column(children: [
          const Text('Pickup code — read to rider', style: TextStyle(fontSize: 12, color: BB.greenDeep, fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          Text(code, style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: BB.greenDeep, letterSpacing: 6)),
          const SizedBox(height: 4),
          const Text('The rider enters this code at pickup', style: TextStyle(fontSize: 11, color: BB.sub)),
        ]),
      );

  Widget _pickRow(Order o, Map<String, dynamic> it) {
    final qty = intOf(it['quantity']);
    final picked = intOrNull(it['picked_quantity']);
    final isFull = picked != null && picked == qty;
    final isShort = picked != null && picked < qty;
    final aisle = strOf(it['aisle']);
    final shelf = strOf(it['shelf']);
    final id = intOf(it['id']);
    final busy = _busyItems.contains(id);

    Widget controls;
    if (o.status == 'packing') {
      controls = Row(mainAxisSize: MainAxisSize.min, children: [
        if (picked == null)
          SizedBox(
            height: 30,
            child: ElevatedButton(
              onPressed: busy ? null : () => _pick(it, qty),
              style: ElevatedButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 16), textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800)),
              child: const Text('Pick'),
            ),
          )
        else
          CountStepper(value: picked, min: 0, max: qty, busy: busy, onChanged: (v) => _pick(it, v)),
        const SizedBox(width: 6),
        SizedBox(
          height: 30,
          child: TextButton(
            onPressed: busy ? null : () => _openShortDialog(it),
            style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 8), foregroundColor: BB.amber),
            child: const Text('Short', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
          ),
        ),
      ]);
    } else if (picked != null) {
      controls = Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
        Text('$picked/$qty picked',
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: isShort ? BB.amber : BB.saveInk)),
        if (intOf(it['refunded_minor']) > 0)
          Text('−${money(intOf(it['refunded_minor']))} refunded', style: const TextStyle(fontSize: 11, color: BB.sub)),
      ]);
    } else {
      controls = const SizedBox.shrink();
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: isFull ? BB.greenTint : isShort ? BB.amberTint : BB.card,
        borderRadius: BorderRadius.circular(BB.radius),
        border: Border.all(color: isFull ? BB.green.withValues(alpha: .35) : isShort ? BB.amber.withValues(alpha: .4) : BB.line),
      ),
      child: Row(children: [
        Icon(
          isFull ? Icons.check_circle : isShort ? Icons.warning_amber_rounded : Icons.radio_button_unchecked,
          size: 18,
          color: isFull ? BB.greenDark : isShort ? BB.amber : BB.faint,
        ),
        const SizedBox(width: 8),
        ArtImage(
          url: productArtUrl({'id': it['product_id'], 'image_url': it['image_url']}),
          width: 44,
          height: 44,
          fit: BoxFit.contain,
          borderRadius: BorderRadius.circular(8),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(strOf(it['name']), maxLines: 2, overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: BB.ink, height: 1.2)),
            const SizedBox(height: 2),
            Text('${strOf(it['unit'])} · ×$qty', style: const TextStyle(fontSize: 11.5, color: BB.sub)),
            Text(
              aisle.isNotEmpty ? 'Aisle $aisle${shelf.isNotEmpty ? ' · Shelf $shelf' : ''}' : 'Location not set',
              style: const TextStyle(fontSize: 11, color: BB.faint),
            ),
          ]),
        ),
        const SizedBox(width: 8),
        controls,
      ]),
    );
  }

  Widget _riderCard(Order o) {
    final r = mapOf(o.raw['rider']);
    final phone = strOf(r['phone']);
    return AppCard(
      child: Row(children: [
        CircleAvatar(
          radius: 20,
          backgroundColor: BB.blueTint,
          child: Text(
            (strOf(r['name']).isNotEmpty ? strOf(r['name']) : 'R').substring(0, 1).toUpperCase(),
            style: const TextStyle(color: BB.blue, fontWeight: FontWeight.w800),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(strOf(r['name']).isNotEmpty ? strOf(r['name']) : 'Rider',
                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: BB.ink)),
            const SizedBox(height: 4),
            Wrap(spacing: 6, children: [
              Pill(label: strOf(r['vehicle']).isNotEmpty ? strOf(r['vehicle']) : 'Bike', color: BB.blue, tint: BB.blueTint, icon: Icons.two_wheeler),
              o.status == 'picked_up'
                  ? const Pill(label: 'On the way', color: BB.amber, tint: BB.amberTint)
                  : const Pill(label: 'Heading to store', color: BB.saveInk, tint: BB.saveTint),
            ]),
          ]),
        ),
        if (phone.isNotEmpty)
          IconButton(onPressed: () => _call(phone), icon: const Icon(Icons.call, color: BB.greenDark, size: 20), tooltip: 'Call rider'),
      ]),
    );
  }

  Widget _bill(Order o) {
    final bill = mapOf(o.raw['bill']);
    final delivery = intOf(bill['delivery_fee_minor']);
    final surge = intOf(bill['surge_fee_minor']);
    final tip = tipOf(o);
    final coupon = couponDiscountOf(o);
    final savings = intOf(bill['savings_minor']);
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('Bill summary', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: BB.ink)),
        const SizedBox(height: 8),
        InfoRow(label: 'Items total', value: money(intOf(bill['items_total_minor']))),
        if (savings > 0) InfoRow(label: 'Basket savings', value: '−${money(savings)}', valueColor: BB.saveInk),
        InfoRow(label: 'Delivery fee', value: delivery == 0 ? 'FREE' : money(delivery), valueColor: delivery == 0 ? BB.saveInk : null),
        InfoRow(label: 'Handling fee', value: money(intOf(bill['handling_fee_minor']))),
        if (surge > 0) InfoRow(label: 'Surge fee', value: money(surge)),
        if (coupon > 0) InfoRow(label: 'Coupon discount', value: '−${money(coupon)}', valueColor: BB.saveInk),
        if (tip > 0) InfoRow(label: 'Rider tip', value: money(tip)),
        const Divider(height: 18),
        InfoRow(label: 'Grand total', value: money(grandTotalOf(o)), bold: true),
        if (o.paymentMethod == 'cod')
          InfoRow(label: 'Collect on delivery', value: money(codDueOf(o)), bold: true, valueColor: BB.amber),
      ]),
    );
  }

  Widget _notice(IconData icon, Color tint, Color color, String text) => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: tint, borderRadius: BorderRadius.circular(BB.radius)),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon, size: 18, color: color),
          const SizedBox(width: 8),
          Expanded(child: Text(text, style: const TextStyle(fontSize: 12.5, color: BB.ink, height: 1.35))),
        ]),
      );

  Widget _cta(Order o) {
    final totalQty = o.items.fold<int>(0, (n, it) => n + intOf(it['quantity']));
    Widget child;
    if (o.status == 'placed') {
      child = Column(mainAxisSize: MainAxisSize.min, children: [
        PrimaryButton(label: 'Start packing', icon: Icons.inventory_2_outlined, loading: _actionBusy, onPressed: _startPacking),
        const SizedBox(height: 6),
        Text('${o.items.length} lines · $totalQty units · payment ${o.paymentStatus}',
            style: const TextStyle(fontSize: 11.5, color: BB.sub)),
      ]);
    } else if (o.status == 'packing') {
      final shorts = _shortages(o);
      child = Column(mainAxisSize: MainAxisSize.min, children: [
        PrimaryButton(label: 'Mark ready · $totalQty units', icon: Icons.check, loading: _actionBusy, onPressed: _packOrder),
        const SizedBox(height: 6),
        Text(
          shorts.isNotEmpty
              ? '${shorts.length} short pick${shorts.length == 1 ? '' : 's'} · ${money(_refundTotal(o))} auto-refund'
              : 'Unpicked items default to full quantity',
          style: const TextStyle(fontSize: 11.5, color: BB.sub),
        ),
      ]);
    } else if (o.status == 'cancelled') {
      child = Column(mainAxisSize: MainAxisSize.min, children: [
        _notice(Icons.cancel_outlined, BB.redTint, BB.red,
            'Cancelled${strOf(o.raw['cancel_reason']).isNotEmpty ? ' — ${strOf(o.raw['cancel_reason'])}' : ''}.'),
        const SizedBox(height: 8),
        SizedBox(width: double.infinity, child: OutlinedButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Back to queue'))),
      ]);
    } else {
      final msg = o.status == 'delivered'
          ? 'Delivered. Nice work!'
          : o.status == 'picked_up'
              ? 'Rider has picked up this order.'
              : mapOf(o.raw['rider']).isNotEmpty
                  ? 'Packed — rider is on the way to the store.'
                  : 'Packed — dispatch is offering this order to riders.';
      child = Column(mainAxisSize: MainAxisSize.min, children: [
        _notice(Icons.check_circle_outline, BB.blueTint, BB.blue, msg),
        const SizedBox(height: 8),
        SizedBox(width: double.infinity, child: OutlinedButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Back to queue'))),
      ]);
    }
    return Container(
      color: BB.card,
      padding: EdgeInsets.fromLTRB(16, 12, 16, 12 + MediaQuery.of(context).padding.bottom),
      child: child,
    );
  }
}