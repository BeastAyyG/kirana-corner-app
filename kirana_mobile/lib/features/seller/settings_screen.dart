import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/config.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'seller_common.dart';
import 'seller_providers.dart';

final settingsProvider = FutureProvider.family<Map<String, dynamic>, String>((ref, storeId) async {
  final data = await ref.watch(apiProvider).storeSettings(storeId);
  return mapFrom(data, 'store');
});

const _feeFields = <Map<String, String>>[
  {'key': 'min_order_minor', 'label': 'Minimum order (₹)'},
  {'key': 'delivery_base_fee_minor', 'label': 'Delivery base fee (₹)'},
  {'key': 'delivery_per_km_minor', 'label': 'Delivery per km (₹)'},
  {'key': 'free_delivery_above_minor', 'label': 'Free delivery above (₹)'},
  {'key': 'handling_fee_minor', 'label': 'Handling fee (₹)'},
  {'key': 'surge_fee_minor', 'label': 'Surge fee (₹)', 'hint': 'Reads ₹0 while surge is off — enter a value to change it'},
  {'key': 'rider_payout_minor', 'label': 'Rider payout per order (₹)', 'hint': 'Leave blank to keep the current payout', 'blank': 'true'},
];

/// Store settings: identity, live switches, rupees-denominated operations and
/// fees (diff-based saves), server URL and sign out.
class SettingsScreen extends ConsumerStatefulWidget {
  final String storeId;
  const SettingsScreen({super.key, required this.storeId});
  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  Map<String, dynamic> _store = {};
  Map<String, dynamic> _baseline = {};
  bool _initialized = false;
  bool _toggleBusy = false;
  bool _saving = false;
  bool _savingUrl = false;

  final _prep = TextEditingController();
  final _radius = TextEditingController();
  final _serverUrl = TextEditingController();
  final Map<String, TextEditingController> _fees = {
    for (final f in _feeFields) f['key']!: TextEditingController(),
  };

  @override
  void didUpdateWidget(covariant SettingsScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.storeId != widget.storeId) {
      _initialized = false;
      _store = {};
      _baseline = {};
    }
  }

  @override
  void dispose() {
    _prep.dispose();
    _radius.dispose();
    _serverUrl.dispose();
    for (final c in _fees.values) {
      c.dispose();
    }
    super.dispose();
  }

  void _initFrom(Map<String, dynamic> store) {
    if (_initialized) return;
    _initialized = true;
    _store = Map.of(store);
    _baseline = Map.of(store);
    _prep.text = '${intOf(store['prep_time_minutes'])}';
    _radius.text = '${store['radius_km'] ?? 0}';
    _serverUrl.text = AppConfig.baseUrl;
    for (final f in _feeFields) {
      _fees[f['key']!]!.text = f['blank'] == 'true' ? '' : rupeesText(intOf(store[f['key']]));
    }
  }

  void _syncStore(Map<String, dynamic> next) {
    _store = {..._store, ...next};
    final current = ref.read(selectedStoreProvider);
    if (current != null && current.id == widget.storeId) {
      ref.read(selectedStoreProvider.notifier).state = Store.fromJson(_store);
    }
  }

  Future<void> _flipToggle(String key, String label) async {
    if (_toggleBusy) return;
    final next = !boolOf(_store[key]);
    setState(() {
      _toggleBusy = true;
      _store = {..._store, key: next}; // optimistic
    });
    try {
      final data = await ref.read(apiProvider).updateStoreSettings(widget.storeId, {key: next});
      if (!mounted) return;
      final res = mapFrom(data, 'store');
      _baseline = {..._baseline, key: boolOf(res[key])};
      _syncStore(res);
      showSnack(context, '$label ${next ? 'on' : 'off'}');
    } catch (e) {
      if (!mounted) return;
      setState(() => _store = {..._store, key: !next});
      showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _toggleBusy = false);
    }
  }

  Future<void> _save() async {
    if (_saving) return;
    final body = <String, dynamic>{};

    final prepRaw = _prep.text.trim();
    if (prepRaw.isNotEmpty) {
      final prep = int.tryParse(prepRaw);
      if (prep == null || prep < 1 || prep > 120) {
        showSnack(context, 'Prep time must be 1–120 minutes', error: true);
        return;
      }
      if (prep != intOf(_baseline['prep_time_minutes'])) body['prep_time_minutes'] = prep;
    }
    final radiusRaw = _radius.text.trim();
    if (radiusRaw.isNotEmpty) {
      final radius = double.tryParse(radiusRaw);
      if (radius == null || radius <= 0 || radius > 15) {
        showSnack(context, 'Radius must be between 0.1 and 15 km', error: true);
        return;
      }
      if (radius != (num.tryParse('${_baseline['radius_km']}') ?? 0)) body['radius_km'] = radius;
    }
    for (final f in _feeFields) {
      final key = f['key']!;
      final raw = _fees[key]!.text.trim();
      if (raw.isEmpty) continue;
      final paise = toPaise(raw);
      if (paise < 0 || paise > 1000000 || double.tryParse(raw) == null) {
        showSnack(context, '${f['label']}: enter a valid amount', error: true);
        return;
      }
      // Rider payout is not returned by the settings GET, so a filled value is
      // always sent; other fees only when they differ from baseline.
      if (f['blank'] == 'true' || paise != intOf(_baseline[key])) body[key] = paise;
    }

    if (body.isEmpty) {
      showSnack(context, 'Nothing changed yet');
      return;
    }
    setState(() => _saving = true);
    try {
      final data = await ref.read(apiProvider).updateStoreSettings(widget.storeId, body);
      if (!mounted) return;
      _baseline = {..._baseline, ...body};
      _syncStore(mapFrom(data, 'store'));
      showSnack(context, 'Settings saved');
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _saveServerUrl() async {
    if (_savingUrl) return;
    setState(() => _savingUrl = true);
    try {
      await AppConfig.setBaseUrl(_serverUrl.text);
      if (!mounted) return;
      _serverUrl.text = AppConfig.baseUrl;
      ref.invalidate(sellerStoresProvider);
      ref.invalidate(settingsProvider(widget.storeId));
      showSnack(context, 'Server URL saved — data will reload from ${AppConfig.baseUrl}');
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _savingUrl = false);
    }
  }

  Future<void> _signOut() async {
    final ok = await askConfirm(
      context,
      title: 'Sign out?',
      message: 'You will need an OTP to sign back in.',
      confirmLabel: 'Sign out',
      danger: true,
    );
    if (!ok || !mounted) return;
    await ref.read(sessionProvider.notifier).logout();
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(settingsProvider(widget.storeId));
    return async.when(
      loading: () => const LoadingView(),
      error: (e, _) => ErrorView(message: errorMessage(e), onRetry: () => ref.invalidate(settingsProvider(widget.storeId))),
      data: (store) {
        _initFrom(store);
        return _form();
      },
    );
  }

  Widget _form() {
    final user = ref.watch(sessionProvider).user;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
      children: [
        AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(strOf(_store['name']), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: BB.ink)),
            const SizedBox(height: 8),
            InfoRow(label: 'Address', value: strOf(_store['address'])),
            InfoRow(label: 'City', value: strOf(_store['city'])),
            InfoRow(label: 'Pincode', value: strOf(_store['pincode'])),
            const SizedBox(height: 6),
            const Text('Store identity is managed by the admin team.', style: TextStyle(fontSize: 11.5, color: BB.faint)),
          ]),
        ),
        const SizedBox(height: 12),
        AppCard(
          child: Column(children: [
            ToggleRow(
              title: 'Store open',
              subtitle: 'Visible to customers nearby',
              value: boolOf(_store['is_open']),
              busy: _toggleBusy,
              onChanged: (_) => _flipToggle('is_open', 'Store'),
            ),
            const Divider(height: 12),
            ToggleRow(
              title: 'Accepting orders',
              subtitle: 'Customers can place new orders',
              value: boolOf(_store['accepting_orders']),
              busy: _toggleBusy,
              onChanged: (_) => _flipToggle('accepting_orders', 'Order intake'),
            ),
            const Divider(height: 12),
            ToggleRow(
              title: 'Surge pricing',
              subtitle: 'Adds ${money(intOf(_baseline['surge_fee_minor']))} during busy periods',
              value: boolOf(_store['surge_active']),
              busy: _toggleBusy,
              onChanged: (_) => _flipToggle('surge_active', 'Surge'),
            ),
          ]),
        ),
        const SizedBox(height: 12),
        AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Operations', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: BB.ink)),
            const SizedBox(height: 10),
            Row(children: [
              Expanded(child: _field(_prep, 'Prep time (minutes)', hint: '1–120', keyboard: TextInputType.number)),
              const SizedBox(width: 10),
              Expanded(child: _field(_radius, 'Delivery radius (km)', hint: 'Up to 15', keyboard: const TextInputType.numberWithOptions(decimal: true))),
            ]),
            const SizedBox(height: 6),
            const Text('Fees', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: BB.ink)),
            const SizedBox(height: 10),
            for (final f in _feeFields)
              _field(_fees[f['key']!]!, f['label']!,
                  hint: f['hint'] ?? '', keyboard: const TextInputType.numberWithOptions(decimal: true)),
            const SizedBox(height: 6),
            PrimaryButton(label: 'Save changes', icon: Icons.check, loading: _saving, onPressed: _save),
            const SizedBox(height: 8),
            const Text('Only changed fields are sent. Amounts are entered in rupees.',
                style: TextStyle(fontSize: 11.5, color: BB.faint)),
          ]),
        ),
        const SizedBox(height: 12),
        AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Server', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: BB.ink)),
            const SizedBox(height: 10),
            _field(_serverUrl, 'Server URL', hint: AppConfig.defaultBaseUrl, keyboard: TextInputType.url),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: _savingUrl ? null : _saveServerUrl,
                icon: const Icon(Icons.dns_outlined, size: 18),
                label: Text(_savingUrl ? 'Saving…' : 'Save server URL'),
              ),
            ),
          ]),
        ),
        const SizedBox(height: 12),
        AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Signed in', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: BB.ink)),
            const SizedBox(height: 8),
            InfoRow(label: 'Picker', value: user?.name.isNotEmpty == true ? user!.name : 'Picker'),
            InfoRow(label: 'Phone', value: phonePretty(user?.phone)),
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: _signOut,
                style: OutlinedButton.styleFrom(foregroundColor: BB.red, side: const BorderSide(color: BB.red)),
                icon: const Icon(Icons.logout, size: 18),
                label: const Text('Sign out'),
              ),
            ),
          ]),
        ),
      ],
    );
  }

  Widget _field(TextEditingController controller, String label, {String hint = '', TextInputType? keyboard}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextField(
        controller: controller,
        keyboardType: keyboard,
        decoration: InputDecoration(
          labelText: label,
          hintText: hint.isEmpty ? null : hint,
          isDense: true,
          helperText: hint.isNotEmpty && label.contains('(₹)') ? hint : null,
          helperMaxLines: 2,
          helperStyle: const TextStyle(fontSize: 10.5, color: BB.faint),
        ),
      ),
    );
  }
}