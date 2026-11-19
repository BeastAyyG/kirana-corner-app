import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_exception.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';

class AuthScreen extends ConsumerStatefulWidget {
  const AuthScreen({super.key});
  @override
  ConsumerState<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends ConsumerState<AuthScreen> {
  final _phone = TextEditingController();
  final _otp = TextEditingController();
  final _name = TextEditingController();
  bool _otpSent = false;
  bool _loading = false;
  String? _error;
  String? _devCode;
  int _resendIn = 0;

  @override
  void dispose() {
    _phone.dispose(); _otp.dispose(); _name.dispose();
    super.dispose();
  }

  Future<void> _requestOtp() async {
    final phone = _phone.text.trim();
    if (!RegExp(r'^[6-9]\d{9}$').hasMatch(phone)) {
      setState(() => _error = 'Enter a valid 10-digit mobile number.');
      return;
    }
    setState(() { _loading = true; _error = null; });
    try {
      final data = await ref.read(apiProvider).requestOtp(phone);
      if (!mounted) return;
      setState(() {
        _otpSent = true;
        _devCode = data is Map ? data['dev_code']?.toString() : null;
        _resendIn = 30;
        if (_devCode != null) _otp.text = _devCode!;
      });
      _tickResend();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _tickResend() {
    Future.doWhile(() async {
      await Future.delayed(const Duration(seconds: 1));
      if (!mounted) return false;
      setState(() => _resendIn = (_resendIn - 1).clamp(0, 30));
      return _resendIn > 0;
    });
  }

  Future<void> _verify() async {
    final code = _otp.text.trim();
    if (!RegExp(r'^\d{6}$').hasMatch(code)) {
      setState(() => _error = 'The OTP is 6 digits.');
      return;
    }
    setState(() { _loading = true; _error = null; });
    try {
      final data = await ref.read(apiProvider).verifyOtp(_phone.text.trim(), code, _name.text.trim());
      final token = data is Map ? data['token']?.toString() ?? '' : '';
      final user = data is Map && data['user'] is Map ? Map<String, dynamic>.from(data['user']) : <String, dynamic>{};
      await ref.read(sessionProvider.notifier).completeLogin(token, user);
      // Router redirect takes over once the session is authenticated.
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: BB.bg,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const SizedBox(height: 48),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(color: BB.green, borderRadius: BorderRadius.circular(18)),
              child: const Icon(Icons.storefront_rounded, color: Colors.white, size: 34),
            ),
            const SizedBox(height: 22),
            const Text('Kirana Corner', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: BB.ink)),
            const SizedBox(height: 6),
            Text(_otpSent ? 'Enter the OTP we sent you' : 'Groceries delivered in minutes',
                style: const TextStyle(fontSize: 15, color: BB.sub)),
            const SizedBox(height: 32),
            if (!_otpSent) ...[
              const Text('Mobile number', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: BB.ink)),
              const SizedBox(height: 8),
              TextField(
                controller: _phone,
                keyboardType: TextInputType.phone,
                maxLength: 10,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                decoration: InputDecoration(
                  counterText: '',
                  prefixIcon: const Padding(padding: EdgeInsets.symmetric(horizontal: 14), child: Text('+91', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15))),
                  prefixIconConstraints: const BoxConstraints(minWidth: 0),
                  hintText: '98765 43210',
                  filled: true, fillColor: BB.card,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(BB.radius), borderSide: const BorderSide(color: BB.line)),
                  enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(BB.radius), borderSide: const BorderSide(color: BB.line)),
                ),
              ),
              const SizedBox(height: 20),
              PrimaryButton(label: 'Continue', loading: _loading, onPressed: _requestOtp),
            ] else ...[
              const Text('One-time password', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: BB.ink)),
              const SizedBox(height: 8),
              TextField(
                controller: _otp,
                keyboardType: TextInputType.number,
                maxLength: 6,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                style: const TextStyle(fontSize: 22, letterSpacing: 8, fontWeight: FontWeight.w800),
                decoration: InputDecoration(
                  counterText: '',
                  hintText: '------',
                  filled: true, fillColor: BB.card,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(BB.radius), borderSide: const BorderSide(color: BB.line)),
                  enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(BB.radius), borderSide: const BorderSide(color: BB.line)),
                ),
              ),
              if (_devCode != null) ...[
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(color: BB.amberTint, borderRadius: BorderRadius.circular(8)),
                  child: Row(children: [
                    const Icon(Icons.bolt_rounded, size: 16, color: BB.amber),
                    const SizedBox(width: 6),
                    Expanded(child: Text('Dev mode OTP: $_devCode (auto-filled)', style: const TextStyle(fontSize: 12, color: BB.ink))),
                  ]),
                ),
              ],
              const SizedBox(height: 16),
              const Text('Your name (new accounts)', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: BB.ink)),
              const SizedBox(height: 8),
              TextField(
                controller: _name,
                textCapitalization: TextCapitalization.words,
                decoration: InputDecoration(
                  hintText: 'e.g. Aarav',
                  filled: true, fillColor: BB.card,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(BB.radius), borderSide: const BorderSide(color: BB.line)),
                  enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(BB.radius), borderSide: const BorderSide(color: BB.line)),
                ),
              ),
              const SizedBox(height: 20),
              PrimaryButton(label: 'Verify & continue', loading: _loading, onPressed: _verify),
              const SizedBox(height: 12),
              Center(
                child: TextButton(
                  onPressed: _resendIn > 0 || _loading ? null : _requestOtp,
                  child: Text(_resendIn > 0 ? 'Resend OTP in ${_resendIn}s' : 'Resend OTP',
                      style: const TextStyle(color: BB.greenDark, fontWeight: FontWeight.w700)),
                ),
              ),
              Center(
                child: TextButton(
                  onPressed: _loading ? null : () => setState(() { _otpSent = false; _error = null; _otp.clear(); }),
                  child: const Text('Change number', style: TextStyle(color: BB.sub)),
                ),
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: BB.redTint, borderRadius: BorderRadius.circular(8)),
                child: Row(children: [
                  const Icon(Icons.error_outline_rounded, color: BB.red, size: 18),
                  const SizedBox(width: 8),
                  Expanded(child: Text(_error!, style: const TextStyle(color: BB.red, fontSize: 13))),
                ]),
              ),
            ],
            const SizedBox(height: 28),
            const Center(child: Text('By continuing you agree to our Terms & Privacy Policy', textAlign: TextAlign.center, style: TextStyle(fontSize: 11, color: BB.faint))),
          ]),
        ),
      ),
    );
  }
}