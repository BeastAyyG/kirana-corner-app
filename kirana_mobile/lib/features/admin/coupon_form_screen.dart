// New coupon form. Money inputs are rupees → integer paise; percent value is a
// whole number capped at 90; flat is capped at ₹10,000. Mirrors web coupons.js.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'admin_providers.dart';
import 'admin_shared.dart';

const _maxFlatPaise = 1000000; // ₹10,000
const _maxPercent = 90;

class CouponFormScreen extends ConsumerStatefulWidget {
  const CouponFormScreen({super.key});
  @override
  ConsumerState<CouponFormScreen> createState() => _CouponFormScreenState();
}

class _CouponFormScreenState extends ConsumerState<CouponFormScreen> {
  final _code = TextEditingController();
  final _value = TextEditingController(text: '50');
  final _minOrder = TextEditingController(text: '199');
  final _maxDiscount = TextEditingController(text: '50');
  final _usageLimit = TextEditingController(text: '10000');
  final _perUserLimit = TextEditingController(text: '1');
  final _description = TextEditingController();
  String _type = 'flat';
  late DateTime _startsAt;
  late DateTime _endsAt;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _startsAt = DateTime(now.year, now.month, now.day, now.hour, now.minute);
    _endsAt = _startsAt.add(const Duration(days: 30));
  }

  @override
  void dispose() {
    for (final c in [_code, _value, _minOrder, _maxDiscount, _usageLimit, _perUserLimit, _description]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _pickDateTime(bool isStart) async {
    final initial = isStart ? _startsAt : _endsAt;
    final date = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime.now().subtract(const Duration(days: 365)),
      lastDate: DateTime.now().add(const Duration(days: 730)),
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(initial));
    if (time == null || !mounted) return;
    final combined = DateTime(date.year, date.month, date.day, time.hour, time.minute);
    setState(() {
      if (isStart) {
        _startsAt = combined;
      } else {
        _endsAt = combined;
      }
    });
  }

  void _fail(String message) => showAdminSnack(context, message, isError: true);

  Future<void> _submit() async {
    final code = _code.text.toUpperCase().replaceAll(RegExp(r'[^A-Z0-9]'), '');
    if (code.length < 3) return _fail('Code needs at least 3 letters or digits');
    if (!_endsAt.isAfter(_startsAt)) return _fail('End time must be after the start time');

    var value = 0;
    if (_type == 'percent') {
      final n = int.tryParse(_value.text.trim());
      if (n == null || n < 0 || n > _maxPercent) return _fail('Percent value must be a whole number from 0 to $_maxPercent');
      value = n;
    } else if (_type == 'flat') {
      final paise = rupeesToPaise(_value.text);
      if (paise == null || paise > _maxFlatPaise) return _fail('Enter a valid flat discount in rupees (up to ₹10,000)');
      value = paise;
    }
    final minOrder = rupeesToPaise(_minOrder.text.trim().isEmpty ? '0' : _minOrder.text);
    final maxDiscount = rupeesToPaise(_maxDiscount.text.trim().isEmpty ? '0' : _maxDiscount.text);
    if (minOrder == null || maxDiscount == null) return _fail('Enter valid rupee amounts');
    final usageLimit = int.tryParse(_usageLimit.text.trim());
    final perUserLimit = int.tryParse(_perUserLimit.text.trim());
    if (usageLimit == null || usageLimit < 1 || perUserLimit == null || perUserLimit < 1) {
      return _fail('Usage limits must be whole numbers of at least 1');
    }

    setState(() => _saving = true);
    try {
      await ref.read(apiProvider).adminCreateCoupon({
        'code': code,
        'type': _type,
        'value': value,
        'min_order_minor': minOrder,
        'max_discount_minor': maxDiscount,
        'starts_at': _startsAt.toUtc().toIso8601String(),
        'ends_at': _endsAt.toUtc().toIso8601String(),
        'usage_limit': usageLimit,
        'per_user_limit': perUserLimit,
        'description': _description.text.trim(),
      });
      ref.invalidate(adminCouponsProvider);
      if (!mounted) return;
      showAdminSnack(context, 'Coupon $code created');
      Navigator.of(context).pop();
    } catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      _fail(adminErrorMessage(error, 'Could not create the coupon'));
    }
  }

  String _fmt(DateTime d) => DateFormat('d MMM y, h:mm a', 'en_IN').format(d);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('New coupon')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
        children: [
          const Text(
            'Money fields are in rupees. Percent value is capped at 90. Free delivery ignores the value field.',
            style: TextStyle(fontSize: 12.5, color: BB.sub, height: 1.4),
          ),
          const SizedBox(height: 16),
          AdminField(
            label: 'Code',
            child: TextField(
              controller: _code,
              maxLength: 20,
              textCapitalization: TextCapitalization.characters,
              decoration: const InputDecoration(hintText: 'WELCOME50', counterText: ''),
            ),
          ),
          AdminField(
            label: 'Type',
            child: DropdownButtonFormField<String>(
              initialValue: _type,
              items: const [
                DropdownMenuItem(value: 'flat', child: Text('Flat off')),
                DropdownMenuItem(value: 'percent', child: Text('Percent off')),
                DropdownMenuItem(value: 'free_delivery', child: Text('Free delivery')),
              ],
              onChanged: _saving ? null : (v) => setState(() => _type = v ?? 'flat'),
            ),
          ),
          if (_type != 'free_delivery')
            AdminField(
              label: 'Value',
              hint: _type == 'flat' ? 'Rupees off (up to ₹10,000).' : 'Whole percent from 0 to 90.',
              child: TextField(
                controller: _value,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(prefixText: _type == 'flat' ? '₹ ' : null, suffixText: _type == 'percent' ? '%' : null),
              ),
            ),
          Row(children: [
            Expanded(
              child: AdminField(
                label: 'Minimum order (₹)',
                child: TextField(controller: _minOrder, keyboardType: const TextInputType.numberWithOptions(decimal: true)),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: AdminField(
                label: 'Max discount (₹)',
                hint: '0 = no cap',
                child: TextField(controller: _maxDiscount, keyboardType: const TextInputType.numberWithOptions(decimal: true)),
              ),
            ),
          ]),
          AdminField(
            label: 'Starts',
            child: _DateTile(value: _fmt(_startsAt), onTap: () => _pickDateTime(true)),
          ),
          AdminField(
            label: 'Ends',
            child: _DateTile(value: _fmt(_endsAt), onTap: () => _pickDateTime(false)),
          ),
          Row(children: [
            Expanded(
              child: AdminField(
                label: 'Total usage limit',
                child: TextField(controller: _usageLimit, keyboardType: TextInputType.number),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: AdminField(
                label: 'Per-user limit',
                child: TextField(controller: _perUserLimit, keyboardType: TextInputType.number),
              ),
            ),
          ]),
          AdminField(
            label: 'Description',
            child: TextField(
              controller: _description,
              maxLength: 160,
              decoration: const InputDecoration(hintText: '₹50 off your first order above ₹199', counterText: ''),
            ),
          ),
          const SizedBox(height: 10),
          PrimaryButton(label: 'Create coupon', loading: _saving, onPressed: _submit),
        ],
      ),
    );
  }
}

class _DateTile extends StatelessWidget {
  final String value;
  final VoidCallback onTap;
  const _DateTile({required this.value, required this.onTap});
  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(BB.radius),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
          decoration: BoxDecoration(
            color: BB.card,
            borderRadius: BorderRadius.circular(BB.radius),
            border: Border.all(color: BB.line),
          ),
          child: Row(children: [
            const Icon(Icons.event_rounded, size: 18, color: BB.greenDark),
            const SizedBox(width: 10),
            Expanded(child: Text(value, style: const TextStyle(fontSize: 14, color: BB.ink, fontWeight: FontWeight.w600))),
            const Icon(Icons.edit_calendar_rounded, size: 16, color: BB.faint),
          ]),
        ),
      );
}