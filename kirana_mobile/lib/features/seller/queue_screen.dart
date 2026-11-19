import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'order_detail_screen.dart';
import 'seller_common.dart';
import 'seller_providers.dart';

const _refreshInterval = Duration(seconds: 10);
const _searchDebounce = Duration(milliseconds: 350);

/// Picker queue: status lanes, server-side search, 10s live refresh.
class QueueScreen extends ConsumerStatefulWidget {
  final String storeId;
  const QueueScreen({super.key, required this.storeId});
  @override
  ConsumerState<QueueScreen> createState() => _QueueScreenState();
}

class _QueueScreenState extends ConsumerState<QueueScreen> {
  final _searchController = TextEditingController();
  Timer? _tick;
  Timer? _debounce;
  String _tab = 'all';
  String? _startingOrderId;

  @override
  void initState() {
    super.initState();
    _tick = Timer.periodic(_refreshInterval, (_) {
      ref.read(queueProvider(widget.storeId).notifier).refresh(silent: true);
    });
  }

  @override
  void didUpdateWidget(covariant QueueScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.storeId != widget.storeId) {
      _searchController.clear();
      _tab = 'all';
    }
  }

  @override
  void dispose() {
    _tick?.cancel();
    _debounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  void _openOrder(Order order) {
    Navigator.of(context)
        .push(MaterialPageRoute(builder: (_) => OrderDetailScreen(storeId: widget.storeId, orderId: order.id)))
        .then((_) => ref.read(queueProvider(widget.storeId).notifier).refresh(silent: true));
  }

  Future<void> _startPacking(Order order) async {
    if (_startingOrderId != null) return;
    setState(() => _startingOrderId = order.id);
    try {
      await ref.read(apiProvider).startPacking(order.id);
      if (!mounted) return;
      await ref.read(queueProvider(widget.storeId).notifier).refresh(silent: true);
      if (!mounted) return;
      _openOrder(order);
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _startingOrderId = null);
    }
  }

  void _onSearch(String value) {
    _debounce?.cancel();
    _debounce = Timer(_searchDebounce, () {
      ref.read(queueProvider(widget.storeId).notifier).search(value);
    });
  }

  @override
  Widget build(BuildContext context) {
    final queue = ref.watch(queueProvider(widget.storeId));
    final orders = queue.orders;

    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
        child: TextField(
          controller: _searchController,
          onChanged: _onSearch,
          textInputAction: TextInputAction.search,
          decoration: InputDecoration(
            hintText: 'Search order label or item…',
            prefixIcon: const Icon(Icons.search, color: BB.faint, size: 20),
            suffixIcon: queue.query.isEmpty
                ? null
                : IconButton(
                    icon: const Icon(Icons.close, size: 18, color: BB.sub),
                    onPressed: () {
                      _searchController.clear();
                      ref.read(queueProvider(widget.storeId).notifier).search('');
                    },
                  ),
            isDense: true,
          ),
        ),
      ),
      SizedBox(
        height: 46,
        child: ListView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          children: [
            _chip('all', 'All', orders.length),
            for (final g in queueGroups)
              _chip(g['key'] as String, g['label'] as String, ordersInGroup(orders, g).length),
          ],
        ),
      ),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Align(
          alignment: Alignment.centerLeft,
          child: Text(
            queue.query.isNotEmpty
                ? '${orders.length} result${orders.length == 1 ? '' : 's'} for “${queue.query}” · live refresh every 10s'
                : '${orders.length} order${orders.length == 1 ? '' : 's'} in queue · live refresh every 10s',
            style: const TextStyle(fontSize: 11, color: BB.sub),
          ),
        ),
      ),
      Expanded(child: _body(queue)),
    ]);
  }

  Widget _chip(String key, String label, int count) {
    final selected = _tab == key;
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: ChoiceChip(
        label: Text(count > 0 ? '$label · $count' : label),
        selected: selected,
        onSelected: (_) => setState(() => _tab = key),
        labelStyle: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w700,
          color: selected ? Colors.white : BB.sub,
        ),
        selectedColor: BB.green,
        backgroundColor: BB.card,
        side: BorderSide(color: selected ? BB.green : BB.line),
        showCheckmark: false,
        visualDensity: VisualDensity.compact,
      ),
    );
  }

  Widget _body(QueueState queue) {
    if (queue.loading && queue.orders.isEmpty) return const LoadingView();
    if (queue.error.isNotEmpty && queue.orders.isEmpty) {
      return ErrorView(
        message: queue.error,
        onRetry: () => ref.read(queueProvider(widget.storeId).notifier).refresh(),
      );
    }

    final orders = queue.orders;
    List<Widget> sections;
    if (_tab == 'all') {
      sections = [
        for (final g in queueGroups)
          if (ordersInGroup(orders, g).isNotEmpty) _group(g, ordersInGroup(orders, g)),
      ];
    } else {
      final g = queueGroups.firstWhere((x) => x['key'] == _tab);
      final list = ordersInGroup(orders, g);
      sections = list.isEmpty ? [_empty()] : [for (final o in list) _orderCard(o)];
    }
    if (sections.isEmpty) sections = [_empty()];

    return RefreshIndicator(
      color: BB.green,
      onRefresh: () => ref.read(queueProvider(widget.storeId).notifier).refresh(silent: true),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
        children: sections,
      ),
    );
  }

  Widget _group(Map<String, Object> g, List<Order> list) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Padding(
        padding: const EdgeInsets.only(top: 14, bottom: 8),
        child: Text('${g['title']} · ${list.length}',
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: BB.ink)),
      ),
      for (final o in list) _orderCard(o),
    ]);
  }

  Widget _empty() {
    if (ref.read(queueProvider(widget.storeId)).query.isNotEmpty) {
      return Padding(
        padding: const EdgeInsets.only(top: 48),
        child: EmptyState(
          icon: Icons.search_off,
          title: 'No matches',
          subtitle: 'Nothing in the queue matches your search.',
          action: OutlinedButton(
            onPressed: () {
              _searchController.clear();
              ref.read(queueProvider(widget.storeId).notifier).search('');
            },
            child: const Text('Clear search'),
          ),
        ),
      );
    }
    const copy = {
      'all': ['Queue is clear', 'New paid orders land here automatically — the queue refreshes every 10 seconds.'],
      'new': ['No new orders', 'As soon as a customer pays (or places a COD order), it appears here.'],
      'packing': ['Nothing being picked', 'Start packing a new order and it moves into this lane.'],
      'ready': ['No packed orders waiting', 'Packed orders wait here until a rider picks them up.'],
      'done': ['No completed orders yet', 'Delivered and cancelled orders show up here.'],
    };
    final c = copy[_tab] ?? copy['all']!;
    return Padding(
      padding: const EdgeInsets.only(top: 48),
      child: EmptyState(icon: Icons.inbox_outlined, title: c[0], subtitle: c[1]),
    );
  }

  Widget _orderCard(Order o) {
    final customer = mapOf(o.raw['customer']);
    final isCod = o.paymentMethod == 'cod';
    final items = o.items;
    final shown = items.take(4).toList();
    final more = items.length - shown.length;
    final placedAt = strOf(o.raw['placed_at']).isNotEmpty ? strOf(o.raw['placed_at']) : o.createdAt;
    final eta = intOrNull(o.raw['eta_promise_minutes']);
    final slot = mapOf(o.raw['slot']);
    final slotLine = o.deliveryType == 'scheduled' && slot.isNotEmpty
        ? '${dateLabel(strOf(slot['slot_date']))} · ${slotRange(strOf(slot['starts_at']), strOf(slot['ends_at']))}'
        : '${eta != null && eta > 0 ? '$eta min promise' : 'Instant'} · ${relativeTime(placedAt)}';

    String actionLabel;
    if (o.status == 'placed') {
      actionLabel = 'Start packing';
    } else if (o.status == 'packing') {
      actionLabel = 'Continue picking';
    } else {
      actionLabel = 'View';
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: AppCard(
        onTap: () => _openOrder(o),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(
              child: Text(prettyCode(o.publicLabel.isNotEmpty ? o.publicLabel : o.id),
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: BB.ink, letterSpacing: .5)),
            ),
            StatusChip(status: o.status),
          ]),
          const SizedBox(height: 4),
          Row(children: [
            Icon(o.deliveryType == 'scheduled' ? Icons.schedule : Icons.bolt, size: 13, color: BB.sub),
            const SizedBox(width: 4),
            Expanded(child: Text(slotLine, style: const TextStyle(fontSize: 12, color: BB.sub))),
          ]),
          const SizedBox(height: 8),
          for (final it in shown)
            Padding(
              padding: const EdgeInsets.only(bottom: 2),
              child: Row(children: [
                Expanded(
                  child: Text(strOf(it['name']), maxLines: 1, overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 12.5, color: BB.ink)),
                ),
                Text('×${intOf(it['quantity'])}', style: const TextStyle(fontSize: 12.5, color: BB.sub, fontWeight: FontWeight.w700)),
              ]),
            ),
          if (more > 0)
            Text('+$more more item${more == 1 ? '' : 's'}', style: const TextStyle(fontSize: 11.5, color: BB.faint)),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(
              child: Text(
                '${strOf(customer['name']).isNotEmpty ? strOf(customer['name']) : 'Customer'}${isCod ? ' · COD' : ''}',
                style: const TextStyle(fontSize: 12, color: BB.sub),
              ),
            ),
            Text(money(grandTotalOf(o)), style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: BB.ink)),
          ]),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            height: 38,
            child: o.status == 'placed'
                ? ElevatedButton.icon(
                    onPressed: _startingOrderId == null ? () => _startPacking(o) : null,
                    icon: _startingOrderId == o.id
                        ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                        : const Icon(Icons.inventory_2_outlined, size: 16),
                    label: Text(actionLabel, style: const TextStyle(fontSize: 13)),
                    style: ElevatedButton.styleFrom(padding: EdgeInsets.zero),
                  )
                : OutlinedButton(
                    onPressed: () => _openOrder(o),
                    style: OutlinedButton.styleFrom(padding: EdgeInsets.zero),
                    child: Text(actionLabel, style: const TextStyle(fontSize: 13)),
                  ),
          ),
        ]),
      ),
    );
  }
}