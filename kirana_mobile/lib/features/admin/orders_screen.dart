// Order desk: status filter chips, label/customer search and a scrollable card
// list. Tap a card for the full detail screen; cancel live orders with a reason.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'admin_actions.dart';
import 'admin_models.dart';
import 'admin_providers.dart';
import 'admin_shared.dart';
import 'order_detail_screen.dart';

const _statusFilters = [
  ['', 'All'],
  ['placed', 'Placed'],
  ['packing', 'Packing'],
  ['packed', 'Packed'],
  ['rider_assigned', 'Assigned'],
  ['picked_up', 'Out for delivery'],
  ['delivered', 'Delivered'],
  ['cancelled', 'Cancelled'],
];

class OrdersScreen extends ConsumerStatefulWidget {
  const OrdersScreen({super.key});
  @override
  ConsumerState<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends ConsumerState<OrdersScreen> {
  String _status = '';
  String _search = '';
  final _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  List<Order> _filtered(List<Order> orders) {
    final q = _search.trim().toLowerCase();
    if (q.isEmpty) return orders;
    return orders.where((o) {
      final customer = rawMap(o.raw['customer']);
      return o.publicLabel.toLowerCase().contains(q) ||
          rawString(customer['name']).toLowerCase().contains(q) ||
          rawString(customer['phone']).toLowerCase().contains(q);
    }).toList();
  }

  Future<void> _openDetail(Order order) async {
    await Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => OrderDetailScreen(orderId: order.id, initial: order),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final ordersAsync = ref.watch(adminOrdersProvider(_status));
    return Column(children: [
      AdminHeading(
        title: 'Order desk',
        subtitle: 'Live operations · newest first',
        actions: [RefreshAction(onPressed: () => ref.invalidate(adminOrdersProvider))],
      ),
      SizedBox(
        height: 40,
        child: ListView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          children: [
            for (final pair in _statusFilters)
              FilterChipButton(
                label: pair[1],
                selected: _status == pair[0],
                onTap: () => setState(() => _status = pair[0]),
              ),
          ],
        ),
      ),
      AdminSearchBox(
        controller: _searchController,
        placeholder: 'Search label, customer or phone…',
        onChanged: (v) => setState(() => _search = v),
      ),
      Expanded(
        child: ordersAsync.when(
          loading: () => const LoadingView(),
          error: (e, _) => ErrorView(
            message: adminErrorMessage(e, 'Could not load orders'),
            onRetry: () => ref.invalidate(adminOrdersProvider(_status)),
          ),
          data: (orders) {
            final list = _filtered(orders);
            if (list.isEmpty) {
              return EmptyState(
                icon: Icons.receipt_long_rounded,
                title: _search.isNotEmpty ? 'No matching orders' : 'No orders here',
                subtitle: _search.isNotEmpty
                    ? 'Try a different label, customer name or phone.'
                    : 'Orders appear as customers check out. Adjust the filters or refresh.',
              );
            }
            return RefreshIndicator(
              color: BB.green,
              onRefresh: () async => ref.refresh(adminOrdersProvider(_status).future),
              child: ListView.separated(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                itemCount: list.length + 1,
                separatorBuilder: (_, __) => const SizedBox(height: 10),
                itemBuilder: (context, index) {
                  if (index == 0) {
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 2),
                      child: Text('${list.length} of ${orders.length} orders', style: const TextStyle(fontSize: 11.5, color: BB.faint)),
                    );
                  }
                  final order = list[index - 1];
                  return _OrderCard(
                    order: order,
                    onTap: () => _openDetail(order),
                    onCancel: () => adminCancelOrderFlow(context, ref, order),
                  );
                },
              ),
            );
          },
        ),
      ),
    ]);
  }
}

class _OrderCard extends StatelessWidget {
  final Order order;
  final VoidCallback onTap;
  final VoidCallback onCancel;
  const _OrderCard({required this.order, required this.onTap, required this.onCancel});

  @override
  Widget build(BuildContext context) {
    final customer = rawMap(order.raw['customer']);
    final customerName = rawString(customer['name']);
    final live = isLive(order.status);
    return AppCard(
      onTap: onTap,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(
            child: Text(order.publicLabel.isEmpty ? order.id : order.publicLabel,
                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5, color: BB.ink)),
          ),
          StatusChip(status: order.status),
        ]),
        const SizedBox(height: 6),
        Text(
          '${order.store?.name ?? '—'} · ${order.items.length} item${order.items.length == 1 ? '' : 's'}',
          style: const TextStyle(fontSize: 12.5, color: BB.sub),
        ),
        if (customerName.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Text('$customerName · ${phonePretty(rawString(customer['phone']))}', style: const TextStyle(fontSize: 12, color: BB.sub)),
          ),
        const SizedBox(height: 8),
        Row(children: [
          Text(money(orderTotalMinor(order)), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: BB.ink)),
          const SizedBox(width: 8),
          Pill(
            label: order.paymentMethod == 'cod' ? 'COD' : 'Online',
            bg: order.paymentMethod == 'cod' ? BB.amberTint : BB.blueTint,
            fg: order.paymentMethod == 'cod' ? BB.amber : BB.blue,
          ),
          const SizedBox(width: 4),
          Pill(label: order.paymentStatus.isEmpty ? '—' : order.paymentStatus, bg: _payBg(order.paymentStatus), fg: _payFg(order.paymentStatus)),
          const Spacer(),
          Text(relativeTime(order.createdAt), style: const TextStyle(fontSize: 11.5, color: BB.faint)),
        ]),
        if (live) ...[
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              onPressed: onCancel,
              style: TextButton.styleFrom(foregroundColor: BB.red, padding: const EdgeInsets.symmetric(horizontal: 10)),
              icon: const Icon(Icons.close_rounded, size: 16),
              label: const Text('Cancel', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
            ),
          ),
        ],
      ]),
    );
  }

  static Color _payBg(String status) => switch (status) {
        'paid' => BB.greenTint,
        'refunded' => BB.line,
        'failed' => BB.redTint,
        _ => BB.amberTint,
      };

  static Color _payFg(String status) => switch (status) {
        'paid' => BB.greenDeep,
        'refunded' => BB.sub,
        'failed' => BB.red,
        _ => BB.amber,
      };
}