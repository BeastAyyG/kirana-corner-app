import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/format.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'customer_data.dart';
import 'customer_providers.dart';
import 'customer_widgets.dart';
import 'track_screen.dart';

/// Notification inbox: order / payment / refund / promo updates with
/// mark-read, mark-all-read and tap-through to the related order.
class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});

  @override
  ConsumerState<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  bool _markingAll = false;

  IconData _iconFor(String kind) {
    switch (kind) {
      case 'order':
      case 'new_order':
        return Icons.local_shipping_outlined;
      case 'payment':
        return Icons.account_balance_wallet_outlined;
      case 'refund':
        return Icons.currency_exchange_rounded;
      case 'promo':
      case 'offer':
        return Icons.local_offer_outlined;
      default:
        return Icons.notifications_none_rounded;
    }
  }

  Color _tintFor(String kind) {
    switch (kind) {
      case 'payment':
        return BB.blueTint;
      case 'refund':
        return BB.amberTint;
      case 'promo':
      case 'offer':
        return BB.saveTint;
      default:
        return BB.greenTint;
    }
  }

  Future<void> _markAllRead() async {
    if (_markingAll) return;
    setState(() => _markingAll = true);
    try {
      await ref.read(apiProvider).readAllNotifications();
      ref.invalidate(notificationsProvider);
      if (mounted) showSnack(context, 'All notifications marked as read');
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _markingAll = false);
    }
  }

  Future<void> _open(NotificationItem n) async {
    if (!n.read) {
      try {
        await ref.read(apiProvider).readNotification(n.id);
        ref.invalidate(notificationsProvider);
      } catch (_) {
        // Reading is best-effort; still open the order.
      }
    }
    if (!mounted || n.orderId.isEmpty) return;
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => TrackScreen(orderId: n.orderId)));
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(notificationsProvider);
    final unread = async.value?.where((n) => !n.read).length ?? 0;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          if (unread > 0)
            TextButton(
              onPressed: _markingAll ? null : _markAllRead,
              child: Text(_markingAll ? 'Marking…' : 'Mark all read',
                  style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800)),
            ),
        ],
      ),
      body: async.when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorView(message: '$e', onRetry: () => ref.invalidate(notificationsProvider)),
        data: (items) => items.isEmpty
            ? const EmptyState(
                icon: Icons.notifications_none_rounded,
                title: 'Nothing here yet',
                subtitle: 'Order updates, payments and offers will show up here.',
              )
            : RefreshIndicator(
                onRefresh: () async {
                  ref.invalidate(notificationsProvider);
                  await ref.read(notificationsProvider.future);
                },
                child: ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                  itemCount: items.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 10),
                  itemBuilder: (_, i) => _tile(items[i]),
                ),
              ),
      ),
    );
  }

  Widget _tile(NotificationItem n) => AppCard(
        onTap: () => _open(n),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            width: 38, height: 38,
            decoration: BoxDecoration(color: _tintFor(n.kind), borderRadius: BorderRadius.circular(10)),
            child: Icon(_iconFor(n.kind), size: 19, color: BB.ink),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(
                  child: Text(n.title.isEmpty ? 'Update' : n.title,
                      style: TextStyle(fontSize: 13, fontWeight: n.read ? FontWeight.w700 : FontWeight.w900, color: BB.ink)),
                ),
                if (!n.read)
                  Container(width: 8, height: 8, decoration: const BoxDecoration(color: BB.green, shape: BoxShape.circle)),
              ]),
              if (n.body.isNotEmpty) ...[
                const SizedBox(height: 2),
                Text(n.body, style: const TextStyle(fontSize: 12, color: BB.sub)),
              ],
              const SizedBox(height: 4),
              Text(relativeTime(n.createdAt), style: const TextStyle(fontSize: 10.5, color: BB.faint, fontWeight: FontWeight.w600)),
            ]),
          ),
          if (n.orderId.isNotEmpty) const Icon(Icons.chevron_right_rounded, size: 20, color: BB.faint),
        ]),
      );
}