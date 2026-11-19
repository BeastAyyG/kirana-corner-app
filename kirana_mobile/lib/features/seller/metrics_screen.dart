import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'order_detail_screen.dart';
import 'seller_common.dart';

class MetricsData {
  final Map<String, dynamic> metrics;
  final List<Order> orders;
  const MetricsData({required this.metrics, required this.orders});
}

final metricsProvider = FutureProvider.family<MetricsData, String>((ref, storeId) async {
  final api = ref.watch(apiProvider);
  final results = await Future.wait([api.storeMetrics(storeId), api.storeQueue(storeId)]);
  return MetricsData(
    metrics: mapFrom(results[0], 'metrics'),
    orders: listFrom(results[1], 'orders').map(Order.fromJson).toList(),
  );
});

/// Today at a glance: KPI cards, live queue breakdown and a needs-attention lane.
class MetricsScreen extends ConsumerWidget {
  final String storeId;
  const MetricsScreen({super.key, required this.storeId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(metricsProvider(storeId));
    return Column(children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 8, 4),
        child: Row(children: [
          Expanded(
            child: Text('Today · ${dateShort(DateTime.now().toIso8601String())}',
                style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: BB.ink)),
          ),
          IconButton(
            tooltip: 'Refresh metrics',
            icon: const Icon(Icons.refresh, color: BB.sub),
            onPressed: () => ref.invalidate(metricsProvider(storeId)),
          ),
        ]),
      ),
      Expanded(
        child: async.when(
          loading: () => const LoadingView(),
          error: (e, _) => ErrorView(message: errorMessage(e), onRetry: () => ref.invalidate(metricsProvider(storeId))),
          data: (data) => _body(context, ref, data),
        ),
      ),
    ]);
  }

  Widget _body(BuildContext context, WidgetRef ref, MetricsData data) {
    final today = mapOf(data.metrics['today']);
    final orders = data.orders;
    final pending = intOf(today['pending']);
    final cancelled = intOf(today['cancelled']);
    final refunds = intOf(today['shortage_refunds_minor']);
    final lowStock = intOf(data.metrics['low_stock_count']);
    final avgPack = today['avg_pack_minutes'];
    final avgPackLabel = avgPack == null ? '—' : '$avgPack min';

    int count(List<String> statuses) => orders.where((o) => statuses.contains(o.status)).length;
    final attention = orders.where((o) => o.status == 'placed' || o.status == 'packing').toList();

    return RefreshIndicator(
      color: BB.green,
      onRefresh: () async {
        ref.invalidate(metricsProvider(storeId));
        await ref.read(metricsProvider(storeId).future);
      },
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
        children: [
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 10,
            crossAxisSpacing: 10,
            childAspectRatio: 1.55,
            children: [
              StatCard(label: 'Orders today', value: '${intOf(today['orders'])}', note: '$pending pending now'),
              StatCard(label: 'GMV (delivered)', value: money(intOf(today['gmv_minor'])), note: 'paid + COD collected'),
              StatCard(label: 'Pending', value: '$pending', note: 'new + packing', noteColor: pending > 0 ? BB.amber : BB.sub),
              StatCard(label: 'Cancelled', value: '$cancelled', note: cancelled > 0 ? 'watch refusals' : 'clean sheet', noteColor: cancelled > 0 ? BB.red : BB.sub),
              StatCard(label: 'Avg pack time', value: avgPackLabel, note: 'start → ready'),
              StatCard(label: 'Shortage refunds', value: moneyExact(refunds), note: 'auto-refunded at pack', noteColor: refunds > 0 ? BB.amber : BB.sub),
              StatCard(label: 'Low stock items', value: '$lowStock', note: lowStock > 0 ? 'restock in Inventory tab' : 'healthy stock', noteColor: lowStock > 0 ? BB.amber : BB.sub),
            ],
          ),
          const SectionHeader(title: 'Queue breakdown'),
          Row(children: [
            _tile('${count(['placed'])}', 'New', BB.greenTint, BB.greenDeep),
            const SizedBox(width: 8),
            _tile('${count(['packing'])}', 'Packing', BB.amberTint, BB.amber),
            const SizedBox(width: 8),
            _tile('${count(['packed', 'rider_assigned', 'picked_up'])}', 'Ready / out', BB.blueTint, BB.blue),
            const SizedBox(width: 8),
            _tile('${count(['delivered', 'cancelled'])}', 'Done', BB.saveTint, BB.saveInk),
          ]),
          const SectionHeader(title: 'Needs attention'),
          if (attention.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: EmptyState(
                icon: Icons.celebration_outlined,
                title: 'All caught up',
                subtitle: 'No new or packing orders right now. The queue refreshes itself.',
              ),
            )
          else
            for (final o in attention) _attentionCard(context, ref, o),
        ],
      ),
    );
  }

  Widget _tile(String value, String label, Color tint, Color ink) => Expanded(
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 14),
          decoration: BoxDecoration(color: tint, borderRadius: BorderRadius.circular(BB.radius)),
          child: Column(children: [
            Text(value, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: ink)),
            const SizedBox(height: 2),
            Text(label, style: const TextStyle(fontSize: 11, color: BB.sub, fontWeight: FontWeight.w600)),
          ]),
        ),
      );

  Widget _attentionCard(BuildContext context, WidgetRef ref, Order o) {
    final customer = mapOf(o.raw['customer']);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: AppCard(
        onTap: () => _open(context, ref, o),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(
              child: Text(prettyCode(o.publicLabel.isNotEmpty ? o.publicLabel : o.id),
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: BB.ink, letterSpacing: .5)),
            ),
            StatusChip(status: o.status),
          ]),
          const SizedBox(height: 6),
          Row(children: [
            Expanded(
              child: Text(
                '${o.items.length} lines · ${strOf(customer['name']).isNotEmpty ? strOf(customer['name']) : 'Customer'}',
                style: const TextStyle(fontSize: 12, color: BB.sub),
              ),
            ),
            Text(money(grandTotalOf(o)), style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800, color: BB.ink)),
          ]),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            height: 36,
            child: o.status == 'placed'
                ? ElevatedButton(
                    onPressed: () => _open(context, ref, o),
                    style: ElevatedButton.styleFrom(padding: EdgeInsets.zero, textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800)),
                    child: const Text('Start packing'),
                  )
                : OutlinedButton(
                    onPressed: () => _open(context, ref, o),
                    style: OutlinedButton.styleFrom(padding: EdgeInsets.zero),
                    child: const Text('Continue picking', style: TextStyle(fontSize: 13)),
                  ),
          ),
        ]),
      ),
    );
  }

  void _open(BuildContext context, WidgetRef ref, Order o) {
    Navigator.of(context)
        .push(MaterialPageRoute(builder: (_) => OrderDetailScreen(storeId: storeId, orderId: o.id)))
        .then((_) => ref.invalidate(metricsProvider(storeId)));
  }
}