import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/config.dart';
import '../../core/format.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'addresses_screen.dart';
import 'customer_providers.dart';
import 'customer_widgets.dart';
import 'notifications_screen.dart';
import 'saved_screen.dart';

/// Account tab: profile, addresses, saved items, notifications, server URL
/// and sign out.
class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});

  Future<void> _editName(BuildContext context, WidgetRef ref, String current) async {
    final controller = TextEditingController(text: current);
    final name = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Your name'),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLength: 60,
          decoration: const InputDecoration(hintText: 'e.g. Aarav Sharma', counterText: ''),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (name == null || name.isEmpty || name == current) return;
    try {
      await ref.read(sessionProvider.notifier).updateName(name);
      if (context.mounted) showSnack(context, 'Name updated');
    } on ApiException catch (e) {
      if (context.mounted) showSnack(context, e.message, error: true);
    }
  }

  Future<void> _editServer(BuildContext context, WidgetRef ref) async {
    final controller = TextEditingController(text: AppConfig.baseUrl);
    final url = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Server URL'),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          TextField(
            controller: controller,
            autofocus: true,
            keyboardType: TextInputType.url,
            decoration: const InputDecoration(hintText: 'http://10.0.2.2:3000'),
          ),
          const SizedBox(height: 10),
          const Text(
            'Use 10.0.2.2 for the Android emulator, or your computer\'s LAN IP for a real device.',
            style: TextStyle(fontSize: 11.5, color: BB.sub),
          ),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(ctx, controller.text.trim()), child: const Text('Save')),
        ],
      ),
    );
    controller.dispose();
    if (url == null || url.isEmpty || url == AppConfig.baseUrl) return;
    await AppConfig.setBaseUrl(url);
    resetCustomerData(ref);
    if (context.mounted) showSnack(context, 'Server updated — reloading data');
  }

  Future<void> _logout(BuildContext context, WidgetRef ref) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sign out?'),
        content: const Text('You will need to sign in again to shop and track orders.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Stay')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Sign out', style: TextStyle(color: BB.red))),
        ],
      ),
    );
    if (ok != true) return;
    await ref.read(sessionProvider.notifier).logout();
  }

  void _about(BuildContext context) {
    showAboutDialog(
      context: context,
      applicationName: 'Kirana Corner',
      applicationVersion: '2.0',
      applicationIcon: Container(
        width: 44, height: 44,
        decoration: BoxDecoration(color: BB.green, borderRadius: BorderRadius.circular(12)),
        child: const Icon(Icons.storefront_rounded, color: Colors.white),
      ),
      children: const [
        Text('Fresh groceries from your neighbourhood kirana, delivered in minutes. Quality checked, fair prices, local stores.',
            style: TextStyle(fontSize: 12.5)),
      ],
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(sessionProvider).user;
    final name = user?.name ?? 'Guest';
    final phone = user?.phone ?? '';
    final addresses = ref.watch(addressesProvider).value ?? const [];
    final saved = ref.watch(savedProvider);
    final unread = ref.watch(notificationsProvider).value?.where((n) => !n.read).length ?? 0;

    return Scaffold(
      appBar: AppBar(title: const Text('Account')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          AppCard(
            child: Row(children: [
              CircleAvatar(
                radius: 27, backgroundColor: BB.greenTint,
                child: Text(name.isEmpty ? 'K' : name.substring(0, 1).toUpperCase(),
                    style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: BB.greenDeep)),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(name, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: BB.ink)),
                  if (phone.isNotEmpty)
                    Text(phonePretty(phone), style: const TextStyle(fontSize: 12.5, color: BB.sub)),
                ]),
              ),
              IconButton(
                tooltip: 'Edit name',
                onPressed: () => _editName(context, ref, name),
                icon: const Icon(Icons.edit_outlined, size: 19, color: BB.greenDark),
              ),
            ]),
          ),
          const SizedBox(height: 14),
          _row(context, Icons.location_on_outlined, 'Delivery addresses',
              subtitle: addresses.isEmpty ? 'Add where we should deliver' : '${addresses.length} saved',
              onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const AddressesScreen()))),
          _row(context, Icons.favorite_border_rounded, 'Saved items',
              subtitle: saved == null ? 'Your wishlist' : '${saved.length} item${saved.length == 1 ? '' : 's'}',
              onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SavedScreen()))),
          _row(context, Icons.notifications_none_rounded, 'Notifications',
              subtitle: unread > 0 ? '$unread unread' : 'Order updates & offers',
              onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const NotificationsScreen()))),
          _row(context, Icons.dns_outlined, 'Server URL',
              subtitle: AppConfig.baseUrl,
              onTap: () => _editServer(context, ref)),
          _row(context, Icons.info_outline_rounded, 'About Kirana Corner',
              subtitle: 'Version 2.0 · demo build',
              onTap: () => _about(context)),
          const SizedBox(height: 18),
          OutlinedButton.icon(
            onPressed: () => _logout(context, ref),
            style: OutlinedButton.styleFrom(
              foregroundColor: BB.red,
              side: const BorderSide(color: BB.red),
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
            icon: const Icon(Icons.logout_rounded, size: 18),
            label: const Text('Sign out', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800)),
          ),
        ],
      ),
    );
  }

  Widget _row(BuildContext context, IconData icon, String title,
      {required String subtitle, required VoidCallback onTap}) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: AppCard(
          onTap: onTap,
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(children: [
            Container(
              width: 38, height: 38,
              decoration: BoxDecoration(color: BB.greenTint, borderRadius: BorderRadius.circular(10)),
              child: Icon(icon, size: 19, color: BB.greenDark),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(title, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800, color: BB.ink)),
                Text(subtitle, maxLines: 1, overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 11.5, color: BB.sub)),
              ]),
            ),
            const Icon(Icons.chevron_right_rounded, size: 20, color: BB.faint),
          ]),
        ),
      );
}