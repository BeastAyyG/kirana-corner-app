import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'rider_helpers.dart';
import 'rider_providers.dart';
import 'rider_widgets.dart';

/// Active delivery workspace: route progress, store & drop stop cards with
/// external maps navigation, pickup-code confirmation, delivery OTP entry,
/// COD cash toggle and the delivered success state (web job.js mirror).
class JobDetailScreen extends ConsumerStatefulWidget {
  final String jobId;
  const JobDetailScreen({super.key, required this.jobId});
  @override
  ConsumerState<JobDetailScreen> createState() => _JobDetailScreenState();
}

class _JobDetailScreenState extends ConsumerState<JobDetailScreen> {
  static const int otpLength = 4;
  static const Duration pollInterval = Duration(seconds: 12);

  final List<TextEditingController> _otp =
      List.generate(otpLength, (_) => TextEditingController());
  final List<FocusNode> _otpFocus = List.generate(otpLength, (_) => FocusNode());
  final TextEditingController _manualCode = TextEditingController();

  Timer? _poll;
  bool _cashFlag = false;
  bool _showManual = false;
  String _busy = ''; // '', 'pickup', 'deliver'
  bool _missingRefreshed = false;

  @override
  void initState() {
    super.initState();
    _poll = Timer.periodic(pollInterval, (_) {
      if (mounted) ref.read(riderJobsProvider.notifier).refresh(silent: true);
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    for (final c in _otp) {
      c.dispose();
    }
    for (final f in _otpFocus) {
      f.dispose();
    }
    _manualCode.dispose();
    super.dispose();
  }

  String get _otpCode => _otp.map((c) => c.text).join();

  void _clearOtp() {
    for (final c in _otp) {
      c.clear();
    }
  }

  void _onOtpChanged(int index, String value) {
    final digits = value.replaceAll(RegExp(r'\D'), '');
    if (digits.length > 1) {
      // Paste: distribute across the boxes.
      for (var i = 0; i < otpLength; i++) {
        _otp[i].text = i < digits.length ? digits[i] : '';
      }
      _otpFocus[digits.length >= otpLength ? otpLength - 1 : digits.length].requestFocus();
    } else {
      _otp[index].text = digits;
      if (digits.isNotEmpty && index < otpLength - 1) {
        _otpFocus[index + 1].requestFocus();
      } else if (digits.isEmpty && index > 0) {
        _otpFocus[index - 1].requestFocus();
      }
    }
    setState(() {});
  }

  Future<void> _confirmPickup(String code) async {
    if (_busy.isNotEmpty) return;
    if (code.isEmpty) {
      showRiderSnack(context, 'Pickup code unavailable — refresh the job', error: true);
      return;
    }
    setState(() => _busy = 'pickup');
    try {
      await ref.read(riderJobsProvider.notifier).pickup(widget.jobId, code);
      _clearOtp();
      _cashFlag = false;
      _showManual = false;
      _manualCode.clear();
      if (mounted) showRiderSnack(context, 'Pickup confirmed — ride safe!');
      ref.read(riderEarningsProvider.notifier).refresh(silent: true);
    } on ApiException catch (e) {
      if (mounted) {
        showRiderSnack(
          context,
          e.code == 'INVALID_PICKUP_CODE'
              ? 'That pickup code does not match. Ask the store for the code on the order.'
              : e.message,
          error: true,
        );
      }
    } catch (_) {
      if (mounted) showRiderSnack(context, 'Could not confirm pickup', error: true);
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  Future<void> _completeDelivery(Job job) async {
    if (_busy.isNotEmpty) return;
    final code = _otpCode;
    if (code.length != otpLength) {
      showRiderSnack(context, 'Enter the 4-digit delivery OTP', error: true);
      return;
    }
    final cod = isCod(job);
    if (cod && !_cashFlag) {
      showRiderSnack(context, 'Collect ${money(job.cashToCollectMinor)} in cash first', error: true);
      return;
    }
    setState(() => _busy = 'deliver');
    try {
      final delivered = await ref
          .read(riderJobsProvider.notifier)
          .deliver(widget.jobId, deliveryOtp: code, cashCollected: cod ? _cashFlag : false);
      if (mounted) showRiderSnack(context, 'Delivered! ${money(jobPayMinor(delivered))} credited');
      ref.read(riderEarningsProvider.notifier).refresh(silent: true);
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.code == 'INVALID_DELIVERY_OTP') {
        setState(_clearOtp);
        _otpFocus[0].requestFocus();
        showRiderSnack(context, 'Wrong OTP — ask the customer to read it again from their Track screen.', error: true);
      } else {
        showRiderSnack(context, e.message, error: true);
      }
    } catch (_) {
      if (mounted) showRiderSnack(context, 'Could not complete delivery', error: true);
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  /* ---------- pieces ---------- */

  Widget _routeCard(Job job) {
    final rider = ref.watch(riderProfileProvider).valueOrNull;
    double progress = 0.05;
    if (job.status == 'delivered') {
      progress = 1;
    } else if (job.status == 'picked_up') {
      progress = 0.5;
      final total = tripKm(job);
      if (rider != null && total > 0 && hasCoords(job.drop)) {
        final left = haversineKm(rider.lat, rider.lng,
            (job.drop['lat'] as num).toDouble(), (job.drop['lng'] as num).toDouble());
        progress = (0.5 + 0.48 * (1 - left / total)).clamp(0.5, 0.98);
      }
    }
    final etaText = job.status == 'delivered'
        ? 'Delivered'
        : job.status == 'picked_up'
            ? '~${etaMinutes(job)} min to drop'
            : '${tripLabel(job)} trip';
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.storefront_outlined, size: 16, color: BB.greenDark),
          const SizedBox(width: 6),
          Expanded(
            child: Text(storeName(job), maxLines: 1, overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: BB.ink)),
          ),
          Text(etaText, style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: BB.blue)),
        ]),
        const SizedBox(height: 10),
        ClipRRect(
          borderRadius: BorderRadius.circular(6),
          child: LinearProgressIndicator(value: progress, minHeight: 7, color: BB.green, backgroundColor: BB.line),
        ),
        const SizedBox(height: 10),
        Row(children: [
          const Icon(Icons.delivery_dining, size: 16, color: BB.greenDark),
          const SizedBox(width: 6),
          Expanded(
            child: Text(rider?.name ?? 'You', maxLines: 1, overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 12, color: BB.sub)),
          ),
          const Icon(Icons.home_outlined, size: 16, color: BB.blue),
          const SizedBox(width: 6),
          Flexible(
            child: Text(receiverName(job), maxLines: 1, overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: BB.ink)),
          ),
        ]),
      ]),
    );
  }

  Widget _stopCard(Job job, {required bool isStore}) {
    final stop = isStore ? job.store : job.drop;
    final title = isStore ? storeName(job) : receiverName(job);
    final address = isStore ? storeAddress(job) : dropAddress(job);
    final phone = isStore ? (job.store['phone'] ?? '').toString() : receiverPhone(job);
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(isStore ? 'Stop 1 · Pickup' : 'Stop 2 · Drop-off',
            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: BB.sub, letterSpacing: .4)),
        const SizedBox(height: 8),
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: isStore ? BB.greenTint : BB.blueTint,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(isStore ? Icons.storefront_outlined : Icons.home_outlined,
                size: 18, color: isStore ? BB.greenDeep : BB.blue),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: BB.ink)),
              if (address.isNotEmpty) ...[
                const SizedBox(height: 2),
                Text(address, style: const TextStyle(fontSize: 12, color: BB.sub)),
              ],
              if (!isStore && phone.isNotEmpty) ...[
                const SizedBox(height: 2),
                Text(phonePretty(phone), style: const TextStyle(fontSize: 12, color: BB.sub)),
              ],
            ]),
          ),
          if (phone.isNotEmpty)
            IconButton(
              onPressed: () => callPhone(context, phone),
              icon: const Icon(Icons.phone, size: 20, color: BB.greenDark),
              tooltip: isStore ? 'Call store' : 'Call customer',
              style: IconButton.styleFrom(backgroundColor: BB.greenTint),
            ),
        ]),
        const SizedBox(height: 10),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            onPressed: () => navigateToStop(context, stop),
            icon: const Icon(Icons.navigation_outlined, size: 16),
            label: Text(isStore ? 'Navigate to store' : 'Navigate to customer'),
          ),
        ),
      ]),
    );
  }

  Widget _pickupStage(Job job) {
    final code = jobField(job, 'pickup_code');
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const SectionHeader(title: 'Confirm pickup'),
      Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: BB.greenTint,
          borderRadius: BorderRadius.circular(BB.radius),
          border: Border.all(color: BB.green.withValues(alpha: .35)),
        ),
        child: Column(children: [
          const Text('Pickup code — show / collect at store',
              style: TextStyle(fontSize: 11.5, color: BB.greenDeep, fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          Text(code.isEmpty ? '······' : code.toUpperCase(),
              style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: BB.greenDeep, letterSpacing: 6)),
          const SizedBox(height: 6),
          Text('Collect the sealed bag for ${jobLabel(job)} from the counter',
              textAlign: TextAlign.center, style: const TextStyle(fontSize: 11.5, color: BB.sub)),
        ]),
      ),
      const SizedBox(height: 10),
      PrimaryButton(
        label: 'Confirm pickup',
        icon: Icons.inventory_2_outlined,
        loading: _busy == 'pickup',
        onPressed: () => _confirmPickup(code),
      ),
      Align(
        alignment: Alignment.centerLeft,
        child: TextButton.icon(
          onPressed: () => setState(() => _showManual = !_showManual),
          icon: const Icon(Icons.edit_outlined, size: 15),
          label: Text(_showManual ? 'Hide manual entry' : 'Store gave you a different code? Enter it manually',
              style: const TextStyle(fontSize: 12)),
        ),
      ),
      if (_showManual)
        Row(children: [
          Expanded(
            child: TextField(
              controller: _manualCode,
              textCapitalization: TextCapitalization.characters,
              maxLength: 6,
              decoration: const InputDecoration(hintText: '6-CHAR CODE', counterText: ''),
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[A-Za-z0-9]'))],
            ),
          ),
          const SizedBox(width: 8),
          OutlinedButton(
            onPressed: _busy.isNotEmpty
                ? null
                : () {
                    final manual = _manualCode.text.trim().toUpperCase();
                    if (manual.length != 6) {
                      showRiderSnack(context, 'Enter the 6-character pickup code', error: true);
                      return;
                    }
                    _confirmPickup(manual);
                  },
            child: const Text('Confirm'),
          ),
        ]),
      ],
    );
  }

  Widget _deliverStage(Job job) {
    final cod = isCod(job);
    final ready = _otpCode.length == otpLength && (!cod || _cashFlag);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const SectionHeader(title: 'Delivery OTP'),
      Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: List.generate(otpLength, (i) => Padding(
          padding: const EdgeInsets.symmetric(horizontal: 6),
          child: SizedBox(
            width: 56,
            child: TextField(
              controller: _otp[i],
              focusNode: _otpFocus[i],
              keyboardType: TextInputType.number,
              textAlign: TextAlign.center,
              maxLength: otpLength, // allow paste of the full code into any box
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: BB.ink),
              decoration: const InputDecoration(counterText: '', hintText: '·'),
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              onChanged: (v) => _onOtpChanged(i, v),
            ),
          ),
        )),
      ),
      const SizedBox(height: 8),
      const Text(
        'Ask the customer to read the 4-digit code from their Track screen in the Kirana Corner customer app.',
        textAlign: TextAlign.center,
        style: TextStyle(fontSize: 12, color: BB.sub),
      ),
      if (cod) ...[
        const SizedBox(height: 12),
        AppCard(
          padding: const EdgeInsets.fromLTRB(14, 10, 8, 10),
          child: Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Cash collected · ${money(job.cashToCollectMinor)}',
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: BB.ink)),
                const SizedBox(height: 2),
                Text(
                  _cashFlag
                      ? 'Cash in hand — you can complete the delivery.'
                      : 'Collect the exact cash before handing over the bag.',
                  style: const TextStyle(fontSize: 12, color: BB.sub),
                ),
              ]),
            ),
            Switch(
              value: _cashFlag,
              onChanged: (v) => setState(() => _cashFlag = v),
              activeColor: Colors.white,
              activeTrackColor: BB.green,
              inactiveThumbColor: Colors.white,
              inactiveTrackColor: BB.faint,
            ),
          ]),
        ),
      ],
      const SizedBox(height: 12),
      PrimaryButton(
        label: cod && !_cashFlag ? 'Complete delivery (collect cash first)' : 'Complete delivery',
        icon: Icons.check_circle_outline,
        loading: _busy == 'deliver',
        onPressed: ready ? () => _completeDelivery(job) : null,
      ),
      ],
    );
  }

  Widget _deliveredStage(Job job) {
    final deliveredAt = jobField(job, 'delivered_at');
    return Column(children: [
      const SizedBox(height: 12),
      AppCard(
        padding: const EdgeInsets.all(22),
        child: Column(children: [
          Container(
            padding: const EdgeInsets.all(14),
            decoration: const BoxDecoration(color: BB.saveTint, shape: BoxShape.circle),
            child: const Icon(Icons.check, size: 34, color: BB.saveInk),
          ),
          const SizedBox(height: 12),
          const Text('Delivered!', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: BB.ink)),
          const SizedBox(height: 6),
          Text(
            '${jobLabel(job)} · ${receiverName(job)}${deliveredAt.isNotEmpty ? ' · ${dateTime(deliveredAt)}' : ''}',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 12, color: BB.sub),
          ),
          const SizedBox(height: 12),
          Text(money(jobPayMinor(job)),
              style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: BB.greenDeep)),
          const Text('Credited to your earnings', style: TextStyle(fontSize: 11.5, color: BB.sub)),
          if (isCod(job)) ...[
            const SizedBox(height: 10),
            RiderPill(
              icon: Icons.payments_outlined,
              label: job.cashCollected
                  ? '${money(job.cashToCollectMinor)} cash collected — deposit at the store'
                  : 'No cash collected',
              bg: BB.amberTint,
              fg: BB.amber,
            ),
          ],
        ]),
      ),
      const SizedBox(height: 16),
      PrimaryButton(
        label: 'Back to jobs',
        icon: Icons.delivery_dining,
        onPressed: () => Navigator.of(context).pop(),
      ),
      const SizedBox(height: 8),
      SizedBox(
        width: double.infinity,
        child: TextButton.icon(
          onPressed: () {
            ref.read(riderTabProvider.notifier).state = 2;
            Navigator.of(context).pop();
          },
          icon: const Icon(Icons.account_balance_wallet_outlined, size: 17),
          label: const Text('View earnings'),
        ),
      ),
    ]);
  }

  Widget _inactiveStage(Job job) {
    const copy = {
      'offered': 'This offer is still waiting for your response on the Jobs screen.',
      'declined': 'You declined this offer. It went to another rider.',
      'expired': 'This offer expired before it was accepted.',
      'cancelled': 'This order was cancelled.',
    };
    return Column(children: [
      const SizedBox(height: 12),
      Container(
        width: double.infinity,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: BB.amberTint, borderRadius: BorderRadius.circular(BB.radius)),
        child: Row(children: [
          const Icon(Icons.info_outline, size: 18, color: BB.amber),
          const SizedBox(width: 8),
          Expanded(
            child: Text(copy[job.status] ?? 'This job is no longer active.',
                style: const TextStyle(fontSize: 12.5, color: BB.ink)),
          ),
        ]),
      ),
      const SizedBox(height: 12),
      PrimaryButton(
        label: 'Back to jobs',
        icon: Icons.delivery_dining,
        onPressed: () => Navigator.of(context).pop(),
      ),
    ]);
  }

  Widget _summaryCard(Job job) {
    final acceptedAt = jobField(job, 'accepted_at');
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const SectionHeader(title: 'Delivery summary'),
      AppCard(
        child: Column(children: [
          InfoRow(label: 'Order', value: jobLabel(job)),
          InfoRow(
            label: 'You earn',
            value: '${money(jobPayMinor(job))}${job.tipMinor > 0 ? ' (incl. ${money(job.tipMinor)} tip)' : ''}',
            bold: true,
            valueColor: BB.greenDeep,
          ),
          InfoRow(label: 'Payment', value: isCod(job) ? 'Cash on delivery' : 'Paid online'),
          if (isCod(job))
            InfoRow(label: 'Cash to collect', value: money(job.cashToCollectMinor), bold: true),
          InfoRow(label: 'Trip distance', value: tripLabel(job)),
          if (acceptedAt.isNotEmpty) InfoRow(label: 'Accepted', value: dateTime(acceptedAt)),
        ]),
      ),
    ]);
  }

  Widget _timeline(Job job) {
    const order = ['offered', 'accepted', 'picked_up', 'delivered'];
    final steps = [
      ('Offer received', 'offered_at'),
      ('Accepted — heading to store', 'accepted_at'),
      ('Picked up — out for delivery', 'picked_up_at'),
      ('Delivered', 'delivered_at'),
    ];
    final reached = order.indexOf(job.status);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const SectionHeader(title: 'Status timeline'),
      AppCard(
        child: Column(
          children: List.generate(steps.length, (i) {
            final done = i <= reached;
            final at = jobField(job, steps[i].$2);
            final isLast = i == steps.length - 1;
            return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Column(children: [
                Container(
                  width: 14,
                  height: 14,
                  decoration: BoxDecoration(
                    color: done ? BB.green : BB.line,
                    shape: BoxShape.circle,
                    border: Border.all(color: done ? BB.greenDark : BB.faint, width: 1.5),
                  ),
                  child: done ? const Icon(Icons.check, size: 9, color: Colors.white) : null,
                ),
                if (!isLast) Container(width: 2, height: 26, color: i < reached ? BB.green : BB.line),
              ]),
              const SizedBox(width: 10),
              Expanded(
                child: Padding(
                  padding: EdgeInsets.only(bottom: isLast ? 0 : 12),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(steps[i].$1,
                        style: TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w700,
                          color: done ? BB.ink : BB.faint,
                        )),
                    if (done && at.isNotEmpty)
                      Text(dateTime(at), style: const TextStyle(fontSize: 11, color: BB.sub)),
                  ]),
                ),
              ),
            ]);
          }),
        ),
      ),
    ]);
  }

  /* ---------- build ---------- */

  @override
  Widget build(BuildContext context) {
    final jobsAsync = ref.watch(riderJobsProvider);
    final jobs = jobsAsync.valueOrNull ?? const <Job>[];
    Job? job;
    for (final j in jobs) {
      if (j.id == widget.jobId) {
        job = j;
        break;
      }
    }

    Widget body;
    if (job == null) {
      if (jobsAsync.isLoading && !jobsAsync.hasValue) {
        body = const LoadingView();
      } else if (jobsAsync.hasError && !jobsAsync.hasValue) {
        body = ErrorView(
          message: jobsAsync.error is ApiException ? (jobsAsync.error as ApiException).message : 'Could not load this delivery.',
          onRetry: () => ref.read(riderJobsProvider.notifier).refresh(),
        );
      } else if (!_missingRefreshed) {
        _missingRefreshed = true;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) ref.read(riderJobsProvider.notifier).refresh(silent: true);
        });
        body = const LoadingView();
      } else {
        body = EmptyState(
          icon: Icons.search_off,
          title: 'Delivery not found',
          subtitle: 'This job may have been reassigned or removed.',
          action: PrimaryButton(label: 'Back to jobs', onPressed: () => Navigator.of(context).pop()),
        );
      }
    } else {
      final j = job;
      final showRoute = ['accepted', 'picked_up', 'delivered'].contains(j.status);
      final showStops = ['accepted', 'picked_up'].contains(j.status);
      final instructions = jobField(j, 'delivery_instructions');
      body = RefreshIndicator(
        color: BB.green,
        onRefresh: () => ref.read(riderJobsProvider.notifier).refresh(silent: true),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
          children: [
            Row(children: [
              Expanded(
                child: Text(jobLabel(j),
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: BB.ink)),
              ),
              JobStatusChip(status: j.status),
            ]),
            if (showRoute) ...[const SizedBox(height: 10), _routeCard(j)],
            if (j.status == 'accepted') _pickupStage(j),
            if (j.status == 'picked_up') _deliverStage(j),
            if (j.status == 'delivered') _deliveredStage(j),
            if (showStops) ...[
              const SizedBox(height: 12),
              _stopCard(j, isStore: true),
              const SizedBox(height: 10),
              _stopCard(j, isStore: false),
            ],
            if (showStops && instructions.isNotEmpty) ...[
              const SizedBox(height: 10),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: BB.blueTint, borderRadius: BorderRadius.circular(BB.radius)),
                child: Row(children: [
                  const Icon(Icons.sticky_note_2_outlined, size: 16, color: BB.blue),
                  const SizedBox(width: 8),
                  Expanded(child: Text(instructions, style: const TextStyle(fontSize: 12, color: BB.ink))),
                ]),
              ),
            ],
            if (j.status != 'offered') _summaryCard(j),
            if (showRoute) _timeline(j),
            if (['offered', 'declined', 'expired', 'cancelled'].contains(j.status)) _inactiveStage(j),
          ],
        ),
      );
    }

    return Scaffold(
      backgroundColor: BB.bg,
      appBar: AppBar(
        title: Text(job != null && job.publicLabel.isNotEmpty ? 'Delivery · ${job.publicLabel}' : 'Active delivery'),
      ),
      body: body,
    );
  }
}