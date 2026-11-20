// Create / edit store. Create mirrors the web form (id, name, address, city,
// pincode, lat, lng, radius_km, prep_time_minutes). Edit supports the keys the
// admin PATCH accepts: name, address, lat, lng, active. Open/accepting/surge
// flags are shown read-only — they are managed by the store app.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/format.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'admin_models.dart';
import 'admin_providers.dart';
import 'admin_shared.dart';
import 'stores_screen.dart' show storeMutationError;

class StoreFormScreen extends ConsumerStatefulWidget {
  final AdminStore? store;
  const StoreFormScreen({super.key, this.store});
  @override
  ConsumerState<StoreFormScreen> createState() => _StoreFormScreenState();
}

class _StoreFormScreenState extends ConsumerState<StoreFormScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _id;
  late final TextEditingController _name;
  late final TextEditingController _address;
  late final TextEditingController _city;
  late final TextEditingController _pincode;
  late final TextEditingController _lat;
  late final TextEditingController _lng;
  late final TextEditingController _radius;
  late final TextEditingController _prep;
  late bool _active;
  bool _saving = false;

  bool get _isEdit => widget.store != null;

  @override
  void initState() {
    super.initState();
    final s = widget.store?.store;
    _id = TextEditingController(text: s?.id ?? '');
    _name = TextEditingController(text: s?.name ?? '');
    _address = TextEditingController(text: s?.address ?? '');
    _city = TextEditingController(text: s?.city ?? '');
    _pincode = TextEditingController(text: s?.pincode ?? '');
    _lat = TextEditingController(text: s == null ? '' : '${s.lat}');
    _lng = TextEditingController(text: s == null ? '' : '${s.lng}');
    _radius = TextEditingController(text: s == null ? '3' : '${s.radiusKm}');
    _prep = TextEditingController(text: s == null ? '8' : '${s.prepTimeMinutes}');
    _active = widget.store?.active ?? true;
  }

  @override
  void dispose() {
    for (final c in [_id, _name, _address, _city, _pincode, _lat, _lng, _radius, _prep]) {
      c.dispose();
    }
    super.dispose();
  }

  String? _required(String? v, String label, {int min = 1}) {
    final text = (v ?? '').trim();
    if (text.length < min) return min > 1 ? '$label needs at least $min characters' : 'Enter the $label';
    return null;
  }

  String? _number(String? v, String label, double min, double max) {
    final n = double.tryParse((v ?? '').trim());
    if (n == null || !n.isFinite) return 'Enter a valid $label';
    if (n < min || n > max) return '$label must be between $min and $max';
    return null;
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _saving = true);
    try {
      final api = ref.read(apiProvider);
      if (_isEdit) {
        await api.adminUpdateStore(widget.store!.store.id, {
          'name': _name.text.trim(),
          'address': _address.text.trim(),
          'lat': double.parse(_lat.text.trim()),
          'lng': double.parse(_lng.text.trim()),
          'active': _active,
        });
      } else {
        await api.adminCreateStore({
          'id': _id.text.trim(),
          'name': _name.text.trim(),
          'address': _address.text.trim(),
          'city': _city.text.trim(),
          'pincode': _pincode.text.trim(),
          'lat': double.parse(_lat.text.trim()),
          'lng': double.parse(_lng.text.trim()),
          'radius_km': double.parse(_radius.text.trim()),
          'prep_time_minutes': double.parse(_prep.text.trim()).round(),
        });
      }
      ref.invalidate(adminStoresProvider);
      ref.invalidate(adminOverviewProvider);
      if (!mounted) return;
      showAdminSnack(context, _isEdit ? 'Store updated' : 'Store created');
      Navigator.of(context).pop();
    } catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      final message = _isEdit
          ? storeMutationError(error, widget.store!)
          : adminErrorMessage(error, 'Could not create the store');
      showAdminSnack(context, message, isError: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.store?.store;
    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? 'Edit ${s?.name ?? 'store'}' : 'Add store')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
          children: [
            if (!_isEdit)
              AdminField(
                label: 'Store id',
                hint: 'Slugified to lowercase letters, numbers and dashes.',
                child: TextFormField(
                  controller: _id,
                  maxLength: 40,
                  decoration: const InputDecoration(hintText: 'saathi-indiranagar', counterText: ''),
                  validator: (v) => _required(v, 'store id', min: 3),
                ),
              ),
            AdminField(
              label: 'Store name',
              child: TextFormField(
                controller: _name,
                maxLength: 80,
                decoration: const InputDecoration(hintText: 'Saathi Kirana — Indiranagar', counterText: ''),
                validator: (v) => _required(v, 'name', min: 3),
              ),
            ),
            AdminField(
              label: 'Street address',
              child: TextFormField(
                controller: _address,
                maxLength: 160,
                decoration: const InputDecoration(hintText: '100 Feet Road, Indiranagar', counterText: ''),
                validator: (v) => _required(v, 'address', min: 5),
              ),
            ),
            if (!_isEdit) ...[
              AdminField(
                label: 'City',
                child: TextFormField(
                  controller: _city,
                  maxLength: 60,
                  decoration: const InputDecoration(hintText: 'Bengaluru', counterText: ''),
                  validator: (v) => _required(v, 'city'),
                ),
              ),
              AdminField(
                label: 'Pincode',
                child: TextFormField(
                  controller: _pincode,
                  maxLength: 6,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(hintText: '560038', counterText: ''),
                  validator: (v) => RegExp(r'^\d{6}$').hasMatch((v ?? '').trim()) ? null : 'Pincode must be exactly 6 digits',
                ),
              ),
            ],
            Row(children: [
              Expanded(
                child: AdminField(
                  label: 'Latitude',
                  child: TextFormField(
                    controller: _lat,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
                    decoration: const InputDecoration(hintText: '12.9784'),
                    validator: (v) => _number(v, 'latitude', -90, 90),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: AdminField(
                  label: 'Longitude',
                  child: TextFormField(
                    controller: _lng,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
                    decoration: const InputDecoration(hintText: '77.6408'),
                    validator: (v) => _number(v, 'longitude', -180, 180),
                  ),
                ),
              ),
            ]),
            if (!_isEdit)
              Row(children: [
                Expanded(
                  child: AdminField(
                    label: 'Delivery radius (km)',
                    child: TextFormField(
                      controller: _radius,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      validator: (v) => _number(v, 'radius', 0.5, 15),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: AdminField(
                    label: 'Prep time (minutes)',
                    child: TextFormField(
                      controller: _prep,
                      keyboardType: TextInputType.number,
                      validator: (v) => _number(v, 'prep time', 1, 120),
                    ),
                  ),
                ),
              ]),
            if (_isEdit) ...[
              SwitchListTile(
                value: _active,
                onChanged: _saving ? null : (v) => setState(() => _active = v),
                title: const Text('Active in the network', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: BB.ink)),
                subtitle: Text(
                  _active ? 'The store can accept orders.' : 'Suspended stores stop taking new orders.',
                  style: const TextStyle(fontSize: 12, color: BB.sub),
                ),
                activeThumbColor: BB.green,
                contentPadding: EdgeInsets.zero,
              ),
              const SizedBox(height: 8),
              AppCard(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text('Store settings', style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800, color: BB.ink)),
                  const SizedBox(height: 8),
                  InfoRow(label: 'City', value: '${s?.city ?? '—'} · ${s?.pincode ?? ''}'),
                  InfoRow(label: 'Radius', value: '${s?.radiusKm ?? 0} km'),
                  InfoRow(label: 'Prep time', value: '${s?.prepTimeMinutes ?? 0} min'),
                  InfoRow(label: 'Minimum order', value: money(s?.minOrderMinor)),
                  InfoRow(label: 'Delivery base fee', value: money(s?.deliveryBaseFeeMinor)),
                  InfoRow(label: 'Per-km fee', value: money(s?.deliveryPerKmMinor)),
                  InfoRow(label: 'Free delivery above', value: money(s?.freeDeliveryAboveMinor)),
                  InfoRow(label: 'Handling fee', value: money(s?.handlingFeeMinor)),
                  InfoRow(label: 'Rider payout', value: money(widget.store?.riderPayoutMinor)),
                  const SizedBox(height: 8),
                  Wrap(spacing: 4, runSpacing: 4, children: [
                    Pill(label: s?.isOpen == true ? 'Open' : 'Closed', bg: s?.isOpen == true ? BB.greenTint : BB.line, fg: s?.isOpen == true ? BB.greenDeep : BB.sub),
                    Pill(label: s?.acceptingOrders == true ? 'Accepting' : 'Paused', bg: s?.acceptingOrders == true ? BB.blueTint : BB.amberTint, fg: s?.acceptingOrders == true ? BB.blue : BB.amber),
                    Pill(label: s?.surgeActive == true ? 'Surge on' : 'Surge off', bg: s?.surgeActive == true ? BB.amberTint : BB.line, fg: s?.surgeActive == true ? BB.amber : BB.sub),
                  ]),
                  const SizedBox(height: 8),
                  const Text(
                    'Open / accepting / surge flags and fees are managed by the store app. The admin API updates name, address, coordinates and active status.',
                    style: TextStyle(fontSize: 11, color: BB.faint, height: 1.4),
                  ),
                ]),
              ),
            ],
            const SizedBox(height: 18),
            PrimaryButton(
              label: _isEdit ? 'Save changes' : 'Create store',
              loading: _saving,
              onPressed: _submit,
            ),
          ],
        ),
      ),
    );
  }
}