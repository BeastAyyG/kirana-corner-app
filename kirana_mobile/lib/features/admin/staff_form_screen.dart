// Staff onboarding: name + 10-digit mobile (becomes +91 sign-in), role
// picker/rider/admin, working/home store and rider vehicle. Mirrors web users.js.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'admin_providers.dart';
import 'admin_shared.dart';

const _vehicles = ['bike', 'scooter', 'cycle', 'ev'];

class StaffFormScreen extends ConsumerStatefulWidget {
  const StaffFormScreen({super.key});
  @override
  ConsumerState<StaffFormScreen> createState() => _StaffFormScreenState();
}

class _StaffFormScreenState extends ConsumerState<StaffFormScreen> {
  final _name = TextEditingController();
  final _phone = TextEditingController();
  String _role = 'picker';
  String _vehicle = 'bike';
  String? _storeId;
  bool _saving = false;

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    super.dispose();
  }

  Future<void> _submit(List<String> storeIds) async {
    final name = _name.text.trim();
    if (name.length < 2) {
      showAdminSnack(context, 'Enter the full name (at least 2 characters)', isError: true);
      return;
    }
    final digits = _phone.text.replaceAll(RegExp(r'\D'), '');
    final local = digits.length > 10 ? digits.substring(digits.length - 10) : digits;
    if (local.length != 10) {
      showAdminSnack(context, 'Enter a valid 10-digit mobile number', isError: true);
      return;
    }
    final needsStore = _role == 'picker' || _role == 'rider';
    final storeId = _storeId ?? (storeIds.isNotEmpty ? storeIds.first : null);
    if (needsStore && storeId == null) {
      showAdminSnack(context, 'Add a store first — pickers and riders need one', isError: true);
      return;
    }
    setState(() => _saving = true);
    try {
      final body = <String, dynamic>{'phone': '+91$local', 'name': name, 'role': _role};
      if (_role == 'picker') body['store_id'] = storeId;
      if (_role == 'rider') {
        body['home_store_id'] = storeId;
        body['vehicle'] = _vehicle;
      }
      await ref.read(apiProvider).adminCreateUser(body);
      ref.invalidate(adminUsersProvider);
      ref.invalidate(adminOverviewProvider);
      if (!mounted) return;
      showAdminSnack(context, '$name added as $_role');
      Navigator.of(context).pop();
    } catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      showAdminSnack(context, adminErrorMessage(error, 'Could not create the account'), isError: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final storesAsync = ref.watch(adminStoresProvider);
    final stores = storesAsync.valueOrNull ?? const [];
    final storeIds = [for (final s in stores) s.store.id];
    final needsStore = _role != 'admin';
    return Scaffold(
      appBar: AppBar(title: const Text('Add staff')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
        children: [
          const Text(
            'The phone number becomes their sign-in. Pickers are bound to a store; riders get a home store.',
            style: TextStyle(fontSize: 12.5, color: BB.sub, height: 1.4),
          ),
          const SizedBox(height: 16),
          AdminField(
            label: 'Full name',
            child: TextField(
              controller: _name,
              maxLength: 80,
              decoration: const InputDecoration(hintText: 'Asha Kumar', counterText: ''),
            ),
          ),
          AdminField(
            label: 'Mobile number',
            hint: '10-digit Indian mobile; +91 is added automatically.',
            child: TextField(
              controller: _phone,
              maxLength: 10,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(hintText: '9000000031', counterText: '', prefixText: '+91 '),
            ),
          ),
          AdminField(
            label: 'Role',
            child: DropdownButtonFormField<String>(
              initialValue: _role,
              items: const [
                DropdownMenuItem(value: 'picker', child: Text('Picker')),
                DropdownMenuItem(value: 'rider', child: Text('Rider')),
                DropdownMenuItem(value: 'admin', child: Text('Admin')),
              ],
              onChanged: _saving ? null : (v) => setState(() => _role = v ?? 'picker'),
            ),
          ),
          if (needsStore)
            AdminField(
              label: 'Store',
              hint: _role == 'picker' ? 'Working store for the picker.' : 'Home store for the rider.',
              child: storesAsync.when(
                loading: () => const LoadingView(),
                error: (e, _) => Text(adminErrorMessage(e, 'Could not load stores'), style: const TextStyle(color: BB.red, fontSize: 12.5)),
                data: (_) => storeIds.isEmpty
                    ? const Text('No stores yet — add a store first.', style: TextStyle(color: BB.amber, fontSize: 12.5, fontWeight: FontWeight.w600))
                    : DropdownButtonFormField<String>(
                        initialValue: _storeId ?? storeIds.first,
                        items: [
                          for (final s in stores) DropdownMenuItem(value: s.store.id, child: Text(s.store.name, overflow: TextOverflow.ellipsis)),
                        ],
                        onChanged: _saving ? null : (v) => setState(() => _storeId = v),
                      ),
              ),
            ),
          if (_role == 'rider')
            AdminField(
              label: 'Vehicle',
              child: DropdownButtonFormField<String>(
                initialValue: _vehicle,
                items: [for (final v in _vehicles) DropdownMenuItem(value: v, child: Text(v))],
                onChanged: _saving ? null : (v) => setState(() => _vehicle = v ?? 'bike'),
              ),
            ),
          const SizedBox(height: 10),
          PrimaryButton(label: 'Create account', loading: _saving, onPressed: () => _submit(storeIds)),
        ],
      ),
    );
  }
}