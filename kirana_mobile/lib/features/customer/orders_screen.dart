import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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
import 'notifications_screen.dart';
import 'track_screen.dart';

/// Order history with All / Live / Delivered / Cancelled filters, reorder and
/// tap-through to live tracking.
class OrdersScreen extends ConsumerStatefulWidget {
  const OrdersScreen({super.key});

  @override
  ConsumerState<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends ConsumerState<OrdersScreen> {
  String _filter = 'all';
  String? _reorderingId;

  static const _filters = [
    ('all', 'All'),
    ('live', 'Live'),
    ('delivered', 'Delivered'),
    ('cancelled', 'Cancelled'),
  ];

  List<Order> _applyFilter(List<Order> orders) {
    switch (_filter) {
      case 'live':
        return orders.where((o) => isLive(o.status)).toList();
      case 'delivered':
        return orders.where((o) => o.status == 'delivered').toList();
      case 'cancelled':
        return orders.where((o) => o.status == 'cancelled').toList();
      default:
        return orders;
    }
  }

  Future<void> _reorder(Order order) async {
    if (_reorderingId != null) return;
    setState(() => _reorderingId = order.id);
    try {
      final res = await ref.read(apiProvider).reorder(order.id);
      final cart = parseCart(mapFrom(res, 'cart'));
      ref.read(cartProvider.notifier).adopt(cart);
      final skipped = listFrom(res, 'skipped');
      if (!mounted) return;
      showSnack(
        context,
        skipped.isEmpty
            ? 'Items added to your basket'
            : 'Added available items · ${skipped.length} unavailable item${skipped.length == 1 ? '' : 's'} skipped',
      );
      ref.read(customerTabProvider.notifier).state = 2;
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _reorderingId = null);
    }
  }

  void _open(Order order) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => TrackScreen(orderId: order.id)));
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<int>(customerTabProvider, (_, next) {
      if (next == 3) ref.invalidate(ordersProvider);
    });
    final ordersAsync = ref.watch(ordersProvider);
    final unread = ref.watch(notificationsProvider).value?.where((n) => !n.read).length ?? 0;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Your orders'),
        actions: [
          IconButton(
            tooltip: 'Notifications',
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const NotificationsScreen())),
            icon: Badge.count(
              count: unread, isLabelVisible: unread > 0,
              child: const Icon(Icons.notifications_none_rounded),
            ),
          ),
        ],
      ),
      body: Column(children: [
        SizedBox(
          height: 46,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            children: [
              for (final (key, label) in _filters) ...[
                ChoiceChip(
                  label: Text(label, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: _filter == key ? Colors.white : BB.ink)),
                  selected: _filter == key,
                  selectedColor: BB.green,
                  backgroundColor: BB.card,
                  side: BorderSide(color: _filter == key ? BB.green : BB.line),
                  onSelected: (_) => setState(() => _filter = key),
                ),
                const SizedBox(width: 8),
              ],
            ],
          ),
        ),
        Expanded(
          child: ordersAsync.when(
            loading: () => const LoadingView(),
            error: (e, _) => ErrorView(message: '$e', onRetry: () => ref.invalidate(ordersProvider)),
            data: (orders) {
              final filtered = _applyFilter(orders);
              if (filtered.isEmpty) {
                return EmptyState(
                  icon: Icons.receipt_long_outlined,
                  title: _filter == 'all' ? 'No orders yet' : 'No ${_filter == 'live' ? 'live' : _filter} orders',
                  subtitle: _filter == 'all'
                      ? 'Your fresh groceries are one tap away.'
                      : 'Orders with this status will appear here.',
                  action: _filter == 'all'
                      ? PrimaryButton(label: 'Start shopping', onPressed: () => ref.read(customerTabProvider.notifier).state = 1)
                      : null,
                );
              }
              return RefreshIndicator(
                onRefresh: () async {
                  ref.invalidate(ordersProvider);
                  await ref.read(ordersProvider.future);
                },
                child: ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 6, 16, 24),
                  itemCount: filtered.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (_, i) => _orderCard(filtered[i]),
                ),
              );
            },
          ),
        ),
      ]),
    );
  }

  Widget _orderCard(Order order) {
    final items = order.items;
    final thumbs = items.take(4).toList();
    final extra = items.length - thumbs.length;
    final names = items.take(3).map((it) => '${it['name'] ?? ''}').where((s) => s.isNotEmpty).join(', ');
    final bill = orderBill(order);
    final slot = orderSlot(order);
    final slotLine = order.deliveryType == 'scheduled' && '${slot['starts_at'] ?? ''}'.isNotEmpty
        ? 'Scheduled · ${dateTime('${slot['starts_at']}')}'
        : 'Instant · ${orderEtaMinutes(order)} min';
    return AppCard(
      onTap: () => _open(order),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text(order.publicLabel.isEmpty ? 'Order' : order.publicLabel,
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w900, color: BB.ink))),
          StatusChip(status: order.status),
        ]),
        const SizedBox(height: 4),
        Text('$slotLine · ${dateShort(order.createdAt)}',
            style: const TextStyle(fontSize: 11.5, color: BB.sub, fontWeight: FontWeight.w600)),
        const SizedBox(height: 10),
        Row(children: [
          for (final it in thumbs) ...[
            LineArt(productId: '${it['product_id'] ?? it['id'] ?? ''}', imageUrl: '${it['image_url'] ?? ''}', size: 40),
            const SizedBox(width: 6),
          ],
          if (extra > 0)
            Container(
              width: 40, height: 40,
              alignment: Alignment.center,
              decoration: BoxDecoration(color: BB.bg, borderRadius: BorderRadius.circular(8), border: Border.all(color: BB.line)),
              child: Text('+$extra', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: BB.sub)),
            ),
        ]),
        if (names.isNotEmpty) ...[
          const SizedBox(height: 8),
          Text(names, maxLines: 1, overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 12, color: BB.sub)),
        ],
        const SizedBox(height: 10),
        Row(children: [
          Expanded(child: Text(money(bill.grandTotalMinor),
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: BB.ink))),
          if (isTerminal(order.status))
            OutlinedButton.icon(
              onPressed: _reorderingId == order.id ? null : () => _reorder(order),
              style: OutlinedButton.styleFrom(
                foregroundColor: BB.greenDark,
                side: const BorderSide(color: BB.green),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              ),
              icon: _reorderingId == order.id
                  ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: BB.greenDark))
                  : const Icon(Icons.refresh_rounded, size: 16),
              label: const Text('Reorder', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800)),
            )
          else
            TextButton(
              onPressed: () => _open(order),
              child: const Text('Track', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800)),
            ),
        ]),
      ]),
    );
  }
}