import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api/api_client.dart';
import '../../core/api/api_exception.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'customer_data.dart';
import 'customer_providers.dart';
import 'customer_widgets.dart';

/// Live order tracking: ETA gauge, route + rider, step timeline, OTP,
/// cancel / rate / demo simulate, items and bill. Polls while the order lives.
class TrackScreen extends ConsumerStatefulWidget {
  final String orderId;
  const TrackScreen({super.key, required this.orderId});

  @override
  ConsumerState<TrackScreen> createState() => _TrackScreenState();
}

class _TrackScreenState extends ConsumerState<TrackScreen> {
  Order? _order;
  String _error = '';
  Timer? _poll;
  bool _simulating = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _fetch();
    _poll = Timer.periodic(const Duration(seconds: 6), (_) => _fetch(silent: true));
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _fetch({bool silent = false}) async {
    try {
      final res = await ref.read(apiProvider).order(widget.orderId);
      if (!mounted) return;
      final order = Order.fromJson(mapFrom(res, 'order'));
      final prevStatus = _order?.status;
      setState(() { _order = order; _error = ''; });
      final active = ref.read(activeOrderProvider);
      if (active == null || active.id == order.id) {
        ref.read(activeOrderProvider.notifier).state = isLive(order.status) ? order : null;
      }
      if (prevStatus != order.status) ref.invalidate(ordersProvider);
      if (isTerminal(order.status)) {
        _poll?.cancel();
        _poll = null;
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      if (!silent || _order == null) setState(() => _error = e.message);
    }
  }

  Future<void> _cancel() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cancel this order?'),
        content: const Text('The store has not started packing yet, so you can still cancel. Any online payment will be refunded.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep order')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Cancel order', style: TextStyle(color: BB.red))),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await ref.read(apiProvider).cancelOrder(widget.orderId, 'Changed my mind');
      if (mounted) showSnack(context, 'Order cancelled');
      await _fetch();
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _simulate() async {
    setState(() => _simulating = true);
    try {
      await ref.read(apiProvider).simulate(widget.orderId);
      if (mounted) showSnack(context, 'Simulation started — watch the order move!');
      _fetch(silent: true);
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    }
    Timer(const Duration(seconds: 32), () {
      if (mounted) setState(() => _simulating = false);
    });
  }

  Future<void> _rate() async {
    final result = await showModalBottomSheet<(int, String)>(
      context: context,
      isScrollControlled: true,
      backgroundColor: BB.card,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(BB.radiusLg))),
      builder: (_) => const _RateSheet(),
    );
    if (result == null || !mounted) return;
    try {
      final res = await ref.read(apiProvider).rateOrder(widget.orderId, result.$1, result.$2);
      if (!mounted) return;
      setState(() => _order = Order.fromJson(mapFrom(res, 'order')));
      ref.invalidate(ordersProvider);
      showSnack(context, 'Thanks for rating your delivery!');
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    }
  }

  Future<void> _callRider(Rider rider) async {
    if (rider.phone.isEmpty) return;
    try {
      await launchUrl(Uri.parse('tel:${rider.phone}'));
    } catch (_) {
      if (mounted) showSnack(context, 'Could not open the dialer', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final order = _order;
    return Scaffold(
      appBar: AppBar(title: Text(order == null ? 'Track order' : 'Order ${order.publicLabel}')),
      body: order == null
          ? (_error.isNotEmpty
              ? ErrorView(message: _error, onRetry: _fetch)
              : const LoadingView())
          : RefreshIndicator(
              onRefresh: _fetch,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                children: [
                  _etaCard(order),
                  const SizedBox(height: 12),
                  _routeCard(order),
                  if (orderRider(order) != null) ...[
                    const SizedBox(height: 12),
                    _riderCard(orderRider(order)!),
                  ],
                  if (orderOtp(order).isNotEmpty && isLive(order.status) && order.status != 'placed') ...[
                    const SizedBox(height: 12),
                    _otpCard(orderOtp(order)),
                  ],
                  const SizedBox(height: 12),
                  _timeline(order),
                  if (isLive(order.status)) ...[
                    const SizedBox(height: 12),
                    _demoCard(order),
                  ],
                  if (order.status == 'placed') ...[
                    const SizedBox(height: 12),
                    OutlinedButton.icon(
                      onPressed: _busy ? null : _cancel,
                      style: OutlinedButton.styleFrom(
                        foregroundColor: BB.red,
                        side: const BorderSide(color: BB.red),
                        padding: const EdgeInsets.symmetric(vertical: 13),
                      ),
                      icon: const Icon(Icons.cancel_outlined, size: 18),
                      label: const Text('Cancel order', style: TextStyle(fontWeight: FontWeight.w800)),
                    ),
                  ],
                  if (order.status == 'delivered') ...[
                    const SizedBox(height: 12),
                    _ratingCard(order),
                  ],
                  const SizedBox(height: 12),
                  _itemsCard(order),
                  const SizedBox(height: 12),
                  BillCard(bill: orderBill(order)),
                  const SizedBox(height: 12),
                  _detailsCard(order),
                ],
              ),
            ),
    );
  }

  Widget _etaCard(Order order) {
    final cancelled = order.status == 'cancelled';
    final delivered = order.status == 'delivered';
    final idx = stepIndex(order.status);
    final progress = cancelled ? 1.0 : (idx / (deliverySteps.length - 1)).clamp(0.0, 1.0);
    final eta = orderEtaMinutes(order);
    final color = cancelled ? BB.red : (delivered ? BB.greenDark : BB.green);
    return AppCard(
      child: Column(children: [
        SizedBox(
          width: 128, height: 128,
          child: Stack(alignment: Alignment.center, children: [
            SizedBox(
              width: 128, height: 128,
              child: CircularProgressIndicator(
                value: progress, strokeWidth: 9,
                color: color, backgroundColor: BB.line, strokeCap: StrokeCap.round,
              ),
            ),
            if (delivered)
              const Icon(Icons.check_circle_rounded, size: 52, color: BB.greenDark)
            else if (cancelled)
              const Icon(Icons.cancel_rounded, size: 52, color: BB.red)
            else
              Column(mainAxisSize: MainAxisSize.min, children: [
                Text('$eta', style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w900, color: BB.ink, height: 1)),
                const Text('min away', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: BB.sub)),
              ]),
          ]),
        ),
        const SizedBox(height: 12),
        StatusChip(status: order.status),
        const SizedBox(height: 8),
        Text(_statusMessage(order), textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 12.5, color: BB.sub, fontWeight: FontWeight.w600)),
      ]),
    );
  }

  String _statusMessage(Order order) {
    if (order.status == 'cancelled') {
      final reason = '${order.raw['cancel_reason'] ?? ''}';
      return reason.isEmpty ? 'This order was cancelled.' : 'Cancelled · $reason';
    }
    if (order.status == 'delivered') return 'Delivered. Thanks for shopping with Kirana Corner!';
    if (order.deliveryType == 'scheduled' && order.status == 'placed') {
      final slot = orderSlot(order);
      if ('${slot['starts_at'] ?? ''}'.isNotEmpty) {
        return 'Scheduled for ${dateTime('${slot['starts_at']}')} – ${timeLabel('${slot['ends_at']}')}';
      }
      return 'Scheduled delivery — the store will pack it before your slot.';
    }
    final eta = orderEtaMinutes(order);
    if (eta > 0) return 'Arriving in about $eta minutes';
    return statusText(order.status);
  }

  Widget _routeCard(Order order) {
    final storeName = order.store?.name ?? 'Kirana Corner store';
    final addr = orderAddress(order);
    final addrLabel = '${addr['label'] ?? 'Delivery address'}';
    final idx = stepIndex(order.status);
    final progress = order.status == 'cancelled' ? 0.0 : (idx / (deliverySteps.length - 1)).clamp(0.0, 1.0);
    final rider = orderRider(order);
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.storefront_rounded, size: 18, color: BB.greenDark),
          const SizedBox(width: 8),
          Expanded(child: Text(storeName, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: BB.ink), overflow: TextOverflow.ellipsis)),
          const Icon(Icons.home_rounded, size: 18, color: BB.blue),
          const SizedBox(width: 8),
          Expanded(child: Text(addrLabel, textAlign: TextAlign.end, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: BB.ink), overflow: TextOverflow.ellipsis)),
        ]),
        const SizedBox(height: 10),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(value: progress, minHeight: 6, color: BB.green, backgroundColor: BB.line),
        ),
        const SizedBox(height: 8),
        Text(
          rider != null && isLive(order.status)
              ? '${rider.name} is on the way · ${orderEtaMinutes(order)} min'
              : statusText(order.status),
          style: const TextStyle(fontSize: 12, color: BB.sub, fontWeight: FontWeight.w600),
        ),
      ]),
    );
  }

  Widget _riderCard(Rider rider) => AppCard(
        child: Row(children: [
          CircleAvatar(
            radius: 22, backgroundColor: BB.greenTint,
            child: Text(rider.name.isEmpty ? 'R' : rider.name.substring(0, 1).toUpperCase(),
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: BB.greenDeep)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(rider.name.isEmpty ? 'Delivery rider' : rider.name,
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: BB.ink)),
              const SizedBox(height: 2),
              Text(rider.vehicle.isEmpty ? 'Your delivery partner' : rider.vehicle,
                  style: const TextStyle(fontSize: 12, color: BB.sub)),
            ]),
          ),
          if (rider.phone.isNotEmpty)
            IconButton(
              onPressed: () => _callRider(rider),
              style: IconButton.styleFrom(backgroundColor: BB.greenTint),
              icon: const Icon(Icons.call_rounded, size: 19, color: BB.greenDark),
            ),
        ]),
      );

  Widget _otpCard(String otp) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: BB.blueTint, borderRadius: BorderRadius.circular(BB.radius),
          border: Border.all(color: BB.blue.withValues(alpha: .35)),
        ),
        child: Row(children: [
          const Icon(Icons.pin_outlined, size: 20, color: BB.blue),
          const SizedBox(width: 10),
          const Expanded(
            child: Text('Delivery OTP — share with your rider',
                style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: BB.ink)),
          ),
          Text(otp, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, letterSpacing: 4, color: BB.blue)),
        ]),
      );

  Widget _timeline(Order order) {
    final cancelled = order.status == 'cancelled';
    final idx = stepIndex(order.status);
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('Order journey', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: BB.ink)),
        const SizedBox(height: 10),
        for (var i = 0; i < deliverySteps.length; i++)
          _stepRow(
            deliverySteps[i]['label']!, deliverySteps[i]['note']!,
            done: !cancelled && i <= idx,
            current: !cancelled && i == idx && isLive(order.status),
            isLast: i == deliverySteps.length - 1 && !cancelled,
            muted: cancelled && i > 0,
          ),
        if (cancelled)
          _stepRow('Cancelled', '${order.raw['cancel_reason'] ?? 'Order was cancelled'}',
              done: true, current: false, isLast: true, danger: true),
      ]),
    );
  }

  Widget _stepRow(String label, String note,
      {required bool done, required bool current, required bool isLast, bool muted = false, bool danger = false}) {
    final color = danger ? BB.red : (done ? BB.greenDark : BB.faint);
    return IntrinsicHeight(
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Column(children: [
          Icon(done ? Icons.check_circle_rounded : Icons.radio_button_unchecked_rounded, size: 19, color: color),
          if (!isLast)
            Expanded(child: Container(width: 2, margin: const EdgeInsets.symmetric(vertical: 2), color: done && !muted ? BB.green.withValues(alpha: .4) : BB.line)),
        ]),
        const SizedBox(width: 10),
        Expanded(
          child: Padding(
            padding: EdgeInsets.only(bottom: isLast ? 0 : 14),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(label, style: TextStyle(fontSize: 13, fontWeight: current || done ? FontWeight.w800 : FontWeight.w600, color: muted ? BB.faint : (danger ? BB.red : BB.ink))),
              Text(note, style: TextStyle(fontSize: 11.5, color: muted ? BB.faint : BB.sub)),
            ]),
          ),
        ),
      ]),
    );
  }

  Widget _demoCard(Order order) {
    final rider = orderRider(order);
    final canSimulate = rider != null && (order.status == 'rider_assigned' || order.status == 'picked_up');
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: BB.amberTint, borderRadius: BorderRadius.circular(BB.radius)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Row(children: [
          Icon(Icons.science_outlined, size: 16, color: BB.amber),
          SizedBox(width: 7),
          Text('Demo controls', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: BB.ink)),
        ]),
        const SizedBox(height: 6),
        Text(
          canSimulate
              ? 'Fast-forward this delivery to see the full journey in ~30 seconds.'
              : 'A rider must accept the job in the rider app before the delivery can be simulated.',
          style: const TextStyle(fontSize: 11.5, color: BB.sub),
        ),
        if (canSimulate) ...[
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: _simulating ? null : _simulate,
            style: OutlinedButton.styleFrom(
              foregroundColor: BB.ink, side: const BorderSide(color: BB.amber),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            ),
            icon: _simulating
                ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: BB.amber))
                : const Icon(Icons.fast_forward_rounded, size: 17),
            label: Text(_simulating ? 'Simulating…' : 'Simulate delivery (demo)',
                style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800)),
          ),
        ],
      ]),
    );
  }

  Widget _ratingCard(Order order) {
    final rating = orderRating(order);
    if (rating != null) {
      final comment = '${order.raw['rating_comment'] ?? ''}';
      return AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Your rating', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: BB.ink)),
          const SizedBox(height: 6),
          Row(children: [
            for (var i = 1; i <= 5; i++)
              Icon(i <= rating ? Icons.star_rounded : Icons.star_outline_rounded, size: 22, color: BB.amber),
          ]),
          if (comment.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(comment, style: const TextStyle(fontSize: 12, color: BB.sub)),
          ],
        ]),
      );
    }
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('How was your delivery?', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: BB.ink)),
        const SizedBox(height: 4),
        const Text('Rate the rider and the packing quality.', style: TextStyle(fontSize: 12, color: BB.sub)),
        const SizedBox(height: 10),
        PrimaryButton(label: 'Rate this order', icon: Icons.star_rounded, onPressed: _rate),
      ]),
    );
  }

  Widget _itemsCard(Order order) => AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${order.items.length} item${order.items.length == 1 ? '' : 's'}',
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: BB.ink)),
          const SizedBox(height: 8),
          for (final item in order.items) ...[
            Row(children: [
              LineArt(productId: '${item['product_id'] ?? item['id'] ?? ''}', imageUrl: '${item['image_url'] ?? ''}', size: 44),
              const SizedBox(width: 10),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('${item['name'] ?? 'Item'}', maxLines: 2, overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: BB.ink)),
                  Text(_itemSub(item), style: const TextStyle(fontSize: 11, color: BB.sub)),
                ]),
              ),
              const SizedBox(width: 8),
              Text(moneyExact(orderItemLineTotal(item)),
                  style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800, color: BB.ink)),
            ]),
            const SizedBox(height: 10),
          ],
        ]),
      );

  String _itemSub(Map<String, dynamic> item) {
    final unit = '${item['unit'] ?? ''}';
    final qty = item['quantity'] ?? 0;
    final picked = item['picked_quantity'];
    final base = unit.isEmpty ? 'Qty $qty' : '$unit · Qty $qty';
    if (picked is num && picked.toInt() != (qty is num ? qty.toInt() : 0)) {
      return '$base · picked ${picked.toInt()}';
    }
    return base;
  }

  Widget _detailsCard(Order order) {
    final addr = orderAddress(order);
    final full = [addr['line1'], addr['line2'], addr['landmark'], addr['city'], addr['pincode']]
        .where((s) => '$s'.isNotEmpty && s != null).join(', ');
    final receiver = '${addr['receiver_name'] ?? ''}';
    final phone = phonePretty('${addr['receiver_phone'] ?? ''}');
    final instructions = '${order.raw['delivery_instructions'] ?? ''}';
    final distance = order.raw['distance_km'];
    final paymentLabel = order.paymentMethod == 'cod' ? 'Cash on delivery' : 'Online payment';
    final payStatus = order.paymentStatus.isEmpty ? '' : ' · ${order.paymentStatus}';
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('Delivery details', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: BB.ink)),
        const SizedBox(height: 8),
        Text(full.isEmpty ? 'Address on file' : full, style: const TextStyle(fontSize: 12.5, color: BB.ink, fontWeight: FontWeight.w600)),
        if (receiver.isNotEmpty || phone.isNotEmpty) ...[
          const SizedBox(height: 2),
          Text([receiver, phone].where((s) => s.isNotEmpty).join(' · '), style: const TextStyle(fontSize: 12, color: BB.sub)),
        ],
        const Divider(height: 20),
        InfoRow(label: 'Payment', value: '$paymentLabel$payStatus'),
        InfoRow(label: 'Placed', value: dateTime('${order.raw['placed_at'] ?? order.createdAt}')),
        if (distance is num) InfoRow(label: 'Distance', value: distanceLabel(distance)),
        if (order.deliveryType == 'scheduled') const InfoRow(label: 'Delivery type', value: 'Scheduled'),
        if (instructions.isNotEmpty) ...[
          const SizedBox(height: 6),
          Text('Note: $instructions', style: const TextStyle(fontSize: 12, color: BB.sub, fontStyle: FontStyle.italic)),
        ],
      ]),
    );
  }
}

class _RateSheet extends StatefulWidget {
  const _RateSheet();

  @override
  State<_RateSheet> createState() => _RateSheetState();
}

class _RateSheetState extends State<_RateSheet> {
  int _stars = 5;
  final _comment = TextEditingController();

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.fromLTRB(20, 18, 20, 18 + MediaQuery.of(context).viewInsets.bottom),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Rate your delivery', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: BB.ink)),
          const SizedBox(height: 12),
          Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            for (var i = 1; i <= 5; i++)
              IconButton(
                onPressed: () => setState(() => _stars = i),
                icon: Icon(i <= _stars ? Icons.star_rounded : Icons.star_outline_rounded,
                    size: 36, color: i <= _stars ? BB.amber : BB.faint),
              ),
          ]),
          const SizedBox(height: 8),
          TextField(
            controller: _comment,
            maxLength: 240,
            maxLines: 2,
            decoration: const InputDecoration(hintText: 'Anything to share? (optional)', counterText: ''),
          ),
          const SizedBox(height: 12),
          PrimaryButton(
            label: 'Submit rating',
            onPressed: () => Navigator.pop(context, (_stars, _comment.text.trim())),
          ),
        ]),
      );
}