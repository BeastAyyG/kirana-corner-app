import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/config.dart';
import '../../core/format.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'rider_helpers.dart';
import 'rider_location.dart';
import 'rider_providers.dart';
import 'rider_shell.dart';
import 'rider_widgets.dart';

/// Account tab: rider profile, vehicle info, duty toggle, name edit,
/// server URL setting and sign-out (web account.js mirror).
class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});

  static const String appVersion = 'v2.0.0';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profileAsync = ref.watch(riderProfileProvider);
    final session = ref.watch(sessionProvider);
    final rider = profileAsync.valueOrNull;
    final online = rider?.isOnline ?? false;
    final homeStoreName = ref.watch(riderHomeStoreProvider).valueOrNull?.name ?? '';
    final name = (rider?.name.isNotEmpty ?? false)
        ? rider!.name
        : (session.user?.name.isNotEmpty ?? false ? session.user!.name : 'Rider');
    final phone = rider?.phone.isNotEmpty ?? false ? rider!.phone : (session.user?.phone ?? '');

    if (profileAsync.isLoading && !profileAsync.hasValue) return const LoadingView();
    if (profileAsync.hasError && !profileAsync.hasValue) {
      return ErrorView(
        message: profileAsync.error is ApiException
            ? (profileAsync.error as ApiException).message
            : 'Could not load your rider profile.',
        onRetry: () => ref.read(riderProfileProvider.notifier).refresh(),
      );
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
      children: [
        AppCard(
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Container(
              width: 52,
              height: 52,
              alignment: Alignment.center,
              decoration: const BoxDecoration(color: BB.greenTint, shape: BoxShape.circle),
              child: Text(name.isNotEmpty ? name[0].toUpperCase() : 'R',
                  style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: BB.greenDeep)),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(name, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: BB.ink)),
                if (phone.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(phonePretty(phone), style: const TextStyle(fontSize: 12.5, color: BB.sub)),
                ],
                const SizedBox(height: 8),
                Wrap(spacing: 6, runSpacing: 6, children: [
                  RiderPill(
                    icon: Icons.delivery_dining,
                    label: (rider?.vehicle.isNotEmpty ?? false) ? rider!.vehicle : 'Bike',
                  ),
                  if (homeStoreName.isNotEmpty)
                    RiderPill(icon: Icons.storefront_outlined, label: homeStoreName, bg: BB.blueTint, fg: BB.blue),
                  RiderPill(
                    icon: Icons.my_location,
                    label: online ? 'On duty' : 'Off duty',
                    bg: online ? BB.greenTint : BB.bg,
                    fg: online ? BB.greenDeep : BB.sub,
                  ),
                ]),
              ]),
            ),
            IconButton(
              onPressed: () => _editName(context, ref, name),
              icon: const Icon(Icons.edit_outlined, size: 19, color: BB.greenDark),
              tooltip: 'Edit name',
            ),
          ]),
        ),
        const SizedBox(height: 12),
        DutyToggleCard(
          online: online,
          busy: ref.watch(riderDutyBusyProvider),
          onChanged: (v) => toggleDuty(context, ref, v),
        ),
        const SizedBox(height: 12),
        AppCard(
          padding: EdgeInsets.zero,
          child: Column(children: [
            _AccountRow(
              icon: Icons.person_outline,
              title: 'Edit name',
              subtitle: 'Shown to customers on their Track screen',
              onTap: () => _editName(context, ref, name),
            ),
            const Divider(height: 1, indent: 52),
            _AccountRow(
              icon: Icons.account_balance_wallet_outlined,
              title: 'Earnings & payouts',
              subtitle: 'Today, this week and all time',
              onTap: () => ref.read(riderTabProvider.notifier).state = 2,
            ),
            const Divider(height: 1, indent: 52),
            _AccountRow(
              icon: Icons.delivery_dining,
              title: 'Delivery jobs',
              subtitle: 'Offers, active deliveries and history',
              onTap: () => ref.read(riderTabProvider.notifier).state = 1,
            ),
            const Divider(height: 1, indent: 52),
            _AccountRow(
              icon: Icons.dns_outlined,
              title: 'Server URL',
              subtitle: AppConfig.baseUrl,
              onTap: () => _editServerUrl(context),
            ),
            const Divider(height: 1, indent: 52),
            _AccountRow(
              icon: Icons.logout,
              title: 'Sign out',
              subtitle: 'You will stop receiving offers',
              danger: true,
              onTap: () => _signOut(context, ref, online),
            ),
          ]),
        ),
        const SizedBox(height: 18),
        Center(
          child: Text('Kirana Corner Rider · $appVersion',
              style: const TextStyle(fontSize: 11.5, color: BB.faint)),
        ),
      ],
    );
  }

  Future<void> _editName(BuildContext context, WidgetRef ref, String current) async {
    final controller = TextEditingController(text: current == 'Rider' ? '' : current);
    final name = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Edit your name'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(
            controller: controller,
            autofocus: true,
            maxLength: 60,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(labelText: 'Full name', hintText: 'e.g. Arjun Kumar'),
          ),
          const SizedBox(height: 4),
          const Text('Customers see this name while tracking their order.',
              style: TextStyle(fontSize: 11.5, color: BB.sub)),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Save name'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (name == null || name.isEmpty || !context.mounted) return;
    try {
      await ref.read(sessionProvider.notifier).updateName(name);
      await ref.read(riderProfileProvider.notifier).refresh();
      if (context.mounted) showRiderSnack(context, 'Name updated');
    } on ApiException catch (e) {
      if (context.mounted) showRiderSnack(context, e.message, error: true);
    } catch (_) {
      if (context.mounted) showRiderSnack(context, 'Could not update name', error: true);
    }
  }

  Future<void> _editServerUrl(BuildContext context) async {
    final controller = TextEditingController(text: AppConfig.baseUrl);
    final value = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Server URL'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(
            controller: controller,
            autofocus: true,
            keyboardType: TextInputType.url,
            decoration: const InputDecoration(
              labelText: 'Base URL',
              hintText: 'http://10.0.2.2:3000',
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Use 10.0.2.2 for the Android emulator, or your computer\'s LAN IP for a real device. Saved across launches.',
            style: TextStyle(fontSize: 11.5, color: BB.sub),
          ),
        ]),
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
    if (value == null || !context.mounted) return;
    try {
      await AppConfig.setBaseUrl(value);
      if (context.mounted) {
        showRiderSnack(context, 'Server URL saved — new requests use ${AppConfig.baseUrl}');
      }
    } catch (_) {
      if (context.mounted) showRiderSnack(context, 'Could not save the server URL', error: true);
    }
  }

  Future<void> _signOut(BuildContext context, WidgetRef ref, bool online) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sign out?'),
        content: Text(online
            ? 'You are on duty — signing out stops new offers. Active deliveries stay assigned to you.'
            : 'You can sign back in anytime with your rider number.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: BB.red),
            child: const Text('Sign out'),
          ),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    ref.read(riderLocationServiceProvider).stop();
    await ref.read(sessionProvider.notifier).logout();
  }
}

class _AccountRow extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final bool danger;
  const _AccountRow({required this.icon, required this.title, required this.subtitle, required this.onTap, this.danger = false});
  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(children: [
            Container(
              padding: const EdgeInsets.all(7),
              decoration: BoxDecoration(
                color: danger ? BB.redTint : BB.greenTint,
                borderRadius: BorderRadius.circular(9),
              ),
              child: Icon(icon, size: 17, color: danger ? BB.red : BB.greenDeep),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(title,
                    style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, color: danger ? BB.red : BB.ink)),
                const SizedBox(height: 1),
                Text(subtitle, maxLines: 1, overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 11.5, color: BB.sub)),
              ]),
            ),
            const Icon(Icons.chevron_right, size: 20, color: BB.faint),
          ]),
        ),
      );
}