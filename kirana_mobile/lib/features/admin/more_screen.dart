// More tab: entry points to Coupons and Audit, server URL configuration,
// logout and the app version label.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/config.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'admin_shared.dart';
import 'audit_screen.dart';
import 'coupons_screen.dart';

const _appVersion = 'Kirana Corner Admin · v1.0.0';

class MoreScreen extends ConsumerStatefulWidget {
  const MoreScreen({super.key});
  @override
  ConsumerState<MoreScreen> createState() => _MoreScreenState();
}

class _MoreScreenState extends ConsumerState<MoreScreen> {
  late final TextEditingController _urlController;
  bool _savingUrl = false;

  @override
  void initState() {
    super.initState();
    _urlController = TextEditingController(text: AppConfig.baseUrl);
  }

  @override
  void dispose() {
    _urlController.dispose();
    super.dispose();
  }

  Future<void> _saveUrl() async {
    setState(() => _savingUrl = true);
    try {
      await AppConfig.setBaseUrl(_urlController.text);
      if (!mounted) return;
      _urlController.text = AppConfig.baseUrl;
      showAdminSnack(context, 'Server updated. Refresh the tabs to reload data.');
    } catch (_) {
      if (mounted) showAdminSnack(context, 'Could not save the server URL', isError: true);
    } finally {
      if (mounted) setState(() => _savingUrl = false);
    }
  }

  Future<void> _logout() async {
    final ok = await confirmAction(
      context,
      title: 'Sign out?',
      message: 'You will need to sign in again with an admin phone number.',
      confirmLabel: 'Sign out',
      danger: true,
    );
    if (!ok || !mounted) return;
    await ref.read(sessionProvider.notifier).logout();
  }

  void _open(Widget screen) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider);
    final user = session.user;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 24),
      children: [
        AdminHeading(title: 'More', subtitle: user == null ? 'Operations tools' : '${user.name} · admin'),
        const SizedBox(height: 6),
        AppCard(
          padding: EdgeInsets.zero,
          child: Column(children: [
            _MoreTile(
              icon: Icons.local_offer_rounded,
              tone: BB.greenTint,
              fg: BB.greenDeep,
              title: 'Coupons',
              subtitle: 'Offers, usage caps and validity windows',
              onTap: () => _open(const CouponsScreen()),
            ),
            const Divider(height: 1, indent: 56),
            _MoreTile(
              icon: Icons.shield_rounded,
              tone: BB.blueTint,
              fg: BB.blue,
              title: 'Audit log',
              subtitle: 'Every privileged action, newest first',
              onTap: () => _open(const AuditScreen()),
            ),
          ]),
        ),
        const SizedBox(height: 14),
        AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Server', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: BB.ink)),
            const SizedBox(height: 4),
            const Text(
              'Base URL of the Kirana Corner backend. Use 10.0.2.2 for the Android emulator, or your LAN IP for a real device.',
              style: TextStyle(fontSize: 11.5, color: BB.sub, height: 1.4),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _urlController,
              keyboardType: TextInputType.url,
              autocorrect: false,
              style: const TextStyle(fontSize: 13.5, color: BB.ink),
              decoration: const InputDecoration(hintText: AppConfig.defaultBaseUrl, isDense: true),
            ),
            const SizedBox(height: 10),
            PrimaryButton(label: 'Save server URL', loading: _savingUrl, onPressed: _saveUrl),
          ]),
        ),
        const SizedBox(height: 14),
        AppCard(
          padding: EdgeInsets.zero,
          child: _MoreTile(
            icon: Icons.logout_rounded,
            tone: BB.redTint,
            fg: BB.red,
            title: 'Sign out',
            subtitle: 'End this admin session',
            onTap: _logout,
          ),
        ),
        const SizedBox(height: 18),
        const Center(child: Text(_appVersion, style: TextStyle(fontSize: 11.5, color: BB.faint))),
      ],
    );
  }
}

class _MoreTile extends StatelessWidget {
  final IconData icon;
  final Color tone;
  final Color fg;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  const _MoreTile({required this.icon, required this.tone, required this.fg, required this.title, required this.subtitle, required this.onTap});

  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(BB.radius),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
          child: Row(children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(color: tone, borderRadius: BorderRadius.circular(9)),
              child: Icon(icon, size: 18, color: fg),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: BB.ink)),
                const SizedBox(height: 1),
                Text(subtitle, style: const TextStyle(fontSize: 11.5, color: BB.sub)),
              ]),
            ),
            const Icon(Icons.chevron_right_rounded, color: BB.faint),
          ]),
        ),
      );
}