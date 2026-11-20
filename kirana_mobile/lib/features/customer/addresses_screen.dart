import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'customer_providers.dart';
import 'customer_widgets.dart';

/// Delivery address manager: select, add, edit, set default, delete.
class AddressesScreen extends ConsumerWidget {
  const AddressesScreen({super.key});

  Future<void> _select(BuildContext context, WidgetRef ref, Address a) async {
    try {
      final info = await applyAddress(ref, a);
      if (!context.mounted) return;
      if (info != null && !info.serviceable) {
        showSnack(context, info.message.isNotEmpty ? info.message : 'This address is outside our delivery area', error: true);
      } else {
        showSnack(context, 'Delivering to ${a.label.isEmpty ? 'address' : a.label}');
      }
    } on ApiException catch (e) {
      showSnack(context, e.message, error: true);
    }
  }

  Future<void> _addOrEdit(BuildContext context, WidgetRef ref, {Address? address}) async {
    final result = await Navigator.of(context).push<Address>(
      MaterialPageRoute(builder: (_) => AddressFormScreen(address: address)),
    );
    if (result == null || !context.mounted) return;
    final selected = ref.read(selectedAddressProvider);
    if (address == null || selected?.id == result.id) {
      await _select(context, ref, result);
    }
  }

  Future<void> _delete(BuildContext context, WidgetRef ref, Address a) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete address?'),
        content: const Text('This address will be removed from your account.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Delete', style: TextStyle(color: BB.red))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(addressesProvider.notifier).remove(a.id);
      final remaining = ref.read(addressesProvider).value ?? const <Address>[];
      if (ref.read(selectedAddressProvider)?.id == a.id) {
        Address? next;
        for (final x in remaining) {
          if (x.isDefault) { next = x; break; }
        }
        next ??= remaining.isNotEmpty ? remaining.first : null;
        if (next != null) {
          if (context.mounted) await _select(context, ref, next);
        } else {
          ref.read(selectedAddressProvider.notifier).state = null;
        }
      }
      if (context.mounted) showSnack(context, 'Address deleted');
    } on ApiException catch (e) {
      if (context.mounted) showSnack(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final addresses = ref.watch(addressesProvider);
    final selectedId = ref.watch(selectedAddressProvider)?.id;
    return Scaffold(
      appBar: AppBar(title: const Text('Delivery addresses')),
      body: addresses.when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorView(message: '$e', onRetry: () => ref.read(addressesProvider.notifier).load()),
        data: (list) => RefreshIndicator(
          color: BB.green,
          onRefresh: () => ref.read(addressesProvider.notifier).load(),
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              const Text('Tap an address to deliver there.', style: TextStyle(fontSize: 12, color: BB.sub)),
              const SizedBox(height: 10),
              if (list.isEmpty)
                const Padding(
                  padding: EdgeInsets.only(top: 40),
                  child: EmptyState(icon: Icons.location_on_outlined, title: 'No addresses yet', subtitle: 'Add a delivery address to get started.'),
                ),
              for (final a in list) ...[
                AddressCard(
                  address: a,
                  selected: a.id == selectedId,
                  onTap: () => _select(context, ref, a),
                  trailing: Wrap(spacing: 6, children: [
                    _miniBtn(Icons.edit_outlined, 'Edit', () => _addOrEdit(context, ref, address: a)),
                    _miniBtn(Icons.check_circle_outline, 'Set default', a.isDefault
                        ? null
                        : () async {
                            try {
                              await ref.read(addressesProvider.notifier).update(a.id, {'is_default': true});
                              await ref.read(addressesProvider.notifier).load();
                              if (context.mounted) showSnack(context, 'Default address updated');
                            } on ApiException catch (e) {
                              if (context.mounted) showSnack(context, e.message, error: true);
                            }
                          }),
                    _miniBtn(Icons.delete_outline, 'Delete', () => _delete(context, ref, a), danger: true),
                  ]),
                ),
                const SizedBox(height: 10),
              ],
              const SizedBox(height: 6),
              PrimaryButton(label: 'Add a new address', icon: Icons.add_rounded, onPressed: () => _addOrEdit(context, ref)),
              const SizedBox(height: 16),
            ],
          ),
        ),
      ),
    );
  }

  Widget _miniBtn(IconData icon, String label, VoidCallback? onTap, {bool danger = false}) => InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
          decoration: BoxDecoration(
            color: onTap == null ? BB.bg : BB.card,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: BB.line),
          ),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(icon, size: 13, color: danger ? BB.red : (onTap == null ? BB.faint : BB.greenDark)),
            const SizedBox(width: 4),
            Text(label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: danger ? BB.red : (onTap == null ? BB.faint : BB.ink))),
          ]),
        ),
      );
}

/// Create / edit address form. Coordinates are optional; when left blank a
/// demo geocode near the default address (Koramangala) is used so the store
/// can deliver, mirroring the web prototype.
class AddressFormScreen extends ConsumerStatefulWidget {
  final Address? address;
  const AddressFormScreen({super.key, this.address});

  @override
  ConsumerState<AddressFormScreen> createState() => _AddressFormScreenState();
}

class _AddressFormScreenState extends ConsumerState<AddressFormScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _label, _name, _phone, _line1, _line2, _landmark, _city, _pincode, _lat, _lng;
  bool _isDefault = false;
  bool _saving = false;

  bool get _isEdit => widget.address != null;

  @override
  void initState() {
    super.initState();
    final a = widget.address;
    final user = ref.read(sessionProvider).user;
    final base = _demoBase();
    final rng = Random();
    final jitterLat = base.$1 + (rng.nextDouble() - 0.5) * 0.004;
    final jitterLng = base.$2 + (rng.nextDouble() - 0.5) * 0.004;
    _label = TextEditingController(text: a?.label ?? 'Home');
    _name = TextEditingController(text: a?.receiverName ?? user?.name ?? '');
    _phone = TextEditingController(text: a?.receiverPhone ?? user?.phone ?? '');
    _line1 = TextEditingController(text: a?.line1 ?? '');
    _line2 = TextEditingController(text: a?.line2 ?? '');
    _landmark = TextEditingController(text: a?.landmark ?? '');
    _city = TextEditingController(text: a?.city ?? 'Bengaluru');
    _pincode = TextEditingController(text: a?.pincode ?? '560034');
    _lat = TextEditingController(text: a != null && a.lat != 0 ? a.lat.toStringAsFixed(6) : jitterLat.toStringAsFixed(6));
    _lng = TextEditingController(text: a != null && a.lng != 0 ? a.lng.toStringAsFixed(6) : jitterLng.toStringAsFixed(6));
    _isDefault = a?.isDefault ?? false;
  }

  (double, double) _demoBase() {
    final addresses = ref.read(addressesProvider).value ?? const <Address>[];
    if (addresses.isNotEmpty && addresses.first.lat != 0) return (addresses.first.lat, addresses.first.lng);
    final store = ref.read(selectedStoreProvider);
    if (store != null && store.lat != 0) return (store.lat, store.lng);
    return (12.939, 77.621);
  }

  @override
  void dispose() {
    for (final c in [_label, _name, _phone, _line1, _line2, _landmark, _city, _pincode, _lat, _lng]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    final lat = double.tryParse(_lat.text.trim());
    final lng = double.tryParse(_lng.text.trim());
    final base = _demoBase();
    final body = <String, dynamic>{
      'label': _label.text.trim().isEmpty ? 'Home' : _label.text.trim(),
      'receiver_name': _name.text.trim(),
      'receiver_phone': _phone.text.replaceAll(RegExp(r'\D'), ''),
      'line1': _line1.text.trim(),
      'line2': _line2.text.trim(),
      'landmark': _landmark.text.trim(),
      'city': _city.text.trim(),
      'pincode': _pincode.text.trim(),
      'lat': lat ?? base.$1,
      'lng': lng ?? base.$2,
      'is_default': _isDefault,
    };
    try {
      final notifier = ref.read(addressesProvider.notifier);
      final addr = _isEdit ? await notifier.update(widget.address!.id, body) : await notifier.create(body);
      if (!mounted) return;
      showSnack(context, _isEdit ? 'Address updated' : 'Address added');
      Navigator.pop(context, addr);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      showSnack(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? 'Edit address' : 'Add delivery address')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _field(_label, 'Label', hint: 'Home / Work'),
            _field(_name, 'Receiver name', required: true),
            _field(_phone, 'Receiver phone', required: true, keyboard: TextInputType.phone, validator: (v) {
              final digits = (v ?? '').replaceAll(RegExp(r'\D'), '');
              if (digits.length < 10 || digits.length > 15) return 'Enter a valid 10-digit phone number';
              return null;
            }),
            _field(_line1, 'Address line 1', required: true, hint: 'Flat, building, street'),
            _field(_line2, 'Address line 2', hint: 'Area, landmark'),
            _field(_landmark, 'Landmark (optional)'),
            _field(_city, 'City', required: true),
            _field(_pincode, 'Pincode', required: true, keyboard: TextInputType.number, validator: (v) {
              if (!RegExp(r'^\d{6}$').hasMatch((v ?? '').trim())) return 'Pincode must be 6 digits';
              return null;
            }),
            const SizedBox(height: 4),
            Row(children: [
              Expanded(child: _field(_lat, 'Latitude (optional)', keyboard: const TextInputType.numberWithOptions(decimal: true, signed: true))),
              const SizedBox(width: 10),
              Expanded(child: _field(_lng, 'Longitude (optional)', keyboard: const TextInputType.numberWithOptions(decimal: true, signed: true))),
            ]),
            const Text('Demo addresses are geocoded near Koramangala so a store can deliver.',
                style: TextStyle(fontSize: 11, color: BB.faint)),
            SwitchListTile(
              value: _isDefault,
              onChanged: (v) => setState(() => _isDefault = v),
              title: const Text('Make this my default address', style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600)),
              activeColor: BB.green,
              contentPadding: EdgeInsets.zero,
            ),
            const SizedBox(height: 10),
            PrimaryButton(label: _isEdit ? 'Save changes' : 'Save address', loading: _saving, onPressed: _save),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }

  Widget _field(TextEditingController controller, String label,
      {bool required = false, String hint = '', TextInputType? keyboard, String? Function(String?)? validator}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextFormField(
        controller: controller,
        keyboardType: keyboard,
        decoration: InputDecoration(labelText: label, hintText: hint.isEmpty ? null : hint),
        validator: validator ??
            (required
                ? (v) => (v == null || v.trim().isEmpty) ? '$label is required' : null
                : null),
      ),
    );
  }
}