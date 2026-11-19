// Admin order cancellation: confirm → reason dialog → API call → refresh.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import 'admin_providers.dart';
import 'admin_shared.dart';

Future<String?> _askReason(BuildContext context, String label) async {
  final controller = TextEditingController();
  final result = await showDialog<String>(
    context: context,
    builder: (ctx) => AlertDialog(
      backgroundColor: BB.card,
      title: Text('Cancel $label?', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: BB.ink)),
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text(
          'The customer is notified and any online payment is refunded. The reason is stored on the order and in the audit log.',
          style: TextStyle(fontSize: 13, color: BB.sub, height: 1.4),
        ),
        const SizedBox(height: 14),
        TextField(
          controller: controller,
          autofocus: true,
          maxLength: 160,
          style: const TextStyle(fontSize: 14, color: BB.ink),
          decoration: const InputDecoration(hintText: 'e.g. Items out of stock', labelText: 'Reason shown to the customer'),
        ),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Keep order')),
        TextButton(
          onPressed: () {
            final reason = controller.text.trim();
            if (reason.isEmpty) return;
            Navigator.of(ctx).pop(reason);
          },
          style: TextButton.styleFrom(foregroundColor: BB.red),
          child: const Text('Cancel order', style: TextStyle(fontWeight: FontWeight.w800)),
        ),
      ],
    ),
  );
  controller.dispose();
  return result;
}

/// Runs the full cancel flow. Returns true when the order was cancelled.
Future<bool> adminCancelOrderFlow(BuildContext context, WidgetRef ref, Order order) async {
  final label = order.publicLabel.isEmpty ? order.id : order.publicLabel;
  final reason = await _askReason(context, label);
  if (reason == null || !context.mounted) return false;
  try {
    await ref.read(apiProvider).adminCancelOrder(order.id, reason);
    ref.invalidate(adminOrdersProvider);
    ref.invalidate(adminOverviewProvider);
    if (context.mounted) showAdminSnack(context, 'Order $label cancelled');
    return true;
  } catch (error) {
    if (context.mounted) {
      showAdminSnack(context, adminErrorMessage(error, 'Could not cancel the order'), isError: true);
    }
    return false;
  }
}