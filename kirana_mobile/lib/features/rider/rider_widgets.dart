import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'job_detail_screen.dart';
import 'rider_helpers.dart';
import 'rider_providers.dart';

void showRiderSnack(BuildContext context, String message, {bool error = false}) {
  if (!context.mounted) return;
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text(message),
      backgroundColor: error ? BB.red : BB.ink,
    ));
}

void openJobDetail(BuildContext context, String jobId) {
  Navigator.of(context).push(MaterialPageRoute(builder: (_) => JobDetailScreen(jobId: jobId)));
}

/// Big duty switch card (web presenceCard mirror).
class DutyToggleCard extends StatelessWidget {
  final bool online;
  final bool busy;
  final ValueChanged<bool> onChanged;
  const DutyToggleCard({super.key, required this.online, required this.busy, required this.onChanged});
  @override
  Widget build(BuildContext context) => AppCard(
        padding: EdgeInsets.zero,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 8, 12),
            child: Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(online ? "You're online" : "You're offline",
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: BB.ink)),
                  const SizedBox(height: 3),
                  Text(
                    online
                        ? 'New delivery offers will pop up here automatically.'
                        : 'Go online to receive delivery offers near your store.',
                    style: const TextStyle(fontSize: 12.5, color: BB.sub),
                  ),
                ]),
              ),
              Switch(
                value: online,
                onChanged: busy ? null : onChanged,
                activeColor: Colors.white,
                activeTrackColor: BB.green,
                inactiveThumbColor: Colors.white,
                inactiveTrackColor: BB.faint,
              ),
            ]),
          ),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
            decoration: BoxDecoration(
              color: online ? BB.greenTint : BB.bg,
              borderRadius: const BorderRadius.vertical(bottom: Radius.circular(BB.radius)),
            ),
            child: Row(children: [
              Icon(online ? Icons.my_location : Icons.schedule, size: 14, color: online ? BB.greenDeep : BB.sub),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  online
                      ? 'Sharing your location with live orders while on duty.'
                      : 'Your location is not shared while off duty.',
                  style: TextStyle(fontSize: 11.5, color: online ? BB.greenDeep : BB.sub, fontWeight: FontWeight.w600),
                ),
              ),
            ]),
          ),
        ]),
      );
}

/// Compact KPI tile for the duty stat row.
class RiderStatTile extends StatelessWidget {
  final String value;
  final String label;
  final Color accent;
  const RiderStatTile({super.key, required this.value, required this.label, this.accent = BB.ink});
  @override
  Widget build(BuildContext context) => Expanded(
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(
            color: BB.card,
            borderRadius: BorderRadius.circular(BB.radius),
            border: Border.all(color: BB.line),
          ),
          child: Column(children: [
            Text(value, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: accent)),
            const SizedBox(height: 2),
            Text(label, style: const TextStyle(fontSize: 11, color: BB.sub, fontWeight: FontWeight.w600)),
          ]),
        ),
      );
}

/// Live offer card with a countdown ring and accept/decline actions.
class OfferCard extends ConsumerStatefulWidget {
  final Job job;
  const OfferCard({super.key, required this.job});
  @override
  ConsumerState<OfferCard> createState() => _OfferCardState();
}

class _OfferCardState extends ConsumerState<OfferCard> {
  static const Duration tick = Duration(milliseconds: 500);
  static const int urgentSeconds = 15;

  Timer? _ticker;
  String _busy = ''; // '', 'accept', 'decline'
  bool _expiryRefreshed = false;

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(tick, (_) {
      if (!mounted) return;
      setState(() {});
      if (_isExpired && !_expiryRefreshed) {
        _expiryRefreshed = true;
        ref.read(riderJobsProvider.notifier).refresh(silent: true);
      }
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  int get _secondsLeft {
    final expires = offerExpiresAt(widget.job);
    if (expires == null) return offerWindowSeconds;
    final remain = expires.difference(DateTime.now()).inMilliseconds;
    return remain <= 0 ? 0 : (remain / 1000).ceil();
  }

  bool get _isExpired => offerExpiresAt(widget.job) != null && _secondsLeft <= 0;

  Future<void> _accept() async {
    if (_busy.isNotEmpty) return;
    setState(() => _busy = 'accept');
    try {
      await ref.read(riderJobsProvider.notifier).accept(widget.job.id);
      if (!mounted) return;
      showRiderSnack(context, 'Accepted ${jobLabel(widget.job)} — head to the store');
      openJobDetail(context, widget.job.id);
    } on ApiException catch (e) {
      if (!mounted) return;
      showRiderSnack(
        context,
        e.code == 'JOB_EXPIRED' ? 'That offer expired — another rider is being assigned.' : e.message,
        error: true,
      );
      ref.read(riderJobsProvider.notifier).refresh(silent: true);
    } catch (_) {
      if (mounted) showRiderSnack(context, 'Could not accept the offer', error: true);
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  Future<void> _decline() async {
    if (_busy.isNotEmpty) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Decline this offer?'),
        content: const Text('The order will be offered to the next nearest rider.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep it')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: BB.red),
            child: const Text('Decline offer'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _busy = 'decline');
    try {
      await ref.read(riderJobsProvider.notifier).decline(widget.job.id);
      if (mounted) showRiderSnack(context, 'Offer declined');
    } on ApiException catch (e) {
      if (mounted) showRiderSnack(context, e.message, error: true);
    } catch (_) {
      if (mounted) showRiderSnack(context, 'Could not decline the offer', error: true);
    } finally {
      if (mounted) setState(() => _busy = '');
      ref.read(riderJobsProvider.notifier).refresh(silent: true);
    }
  }

  Widget _countdownRing() {
    final secs = _secondsLeft;
    final fraction = (secs / offerWindowSeconds).clamp(0.0, 1.0);
    final urgent = secs <= urgentSeconds;
    final color = _isExpired ? BB.faint : (urgent ? BB.red : BB.green);
    return SizedBox(
      width: 46,
      height: 46,
      child: Stack(alignment: Alignment.center, children: [
        SizedBox(
          width: 46,
          height: 46,
          child: CircularProgressIndicator(
            value: fraction,
            strokeWidth: 4.5,
            color: color,
            backgroundColor: BB.line,
          ),
        ),
        Text('$secs', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: color)),
      ]),
    );
  }

  Widget _stop(Color dot, String title, String subtitle) => Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            margin: const EdgeInsets.only(top: 3),
            width: 10,
            height: 10,
            decoration: BoxDecoration(color: dot, shape: BoxShape.circle),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, maxLines: 1, overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: BB.ink)),
              if (subtitle.isNotEmpty)
                Text(subtitle, maxLines: 2, overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 11.5, color: BB.sub)),
            ]),
          ),
        ],
      );

  @override
  Widget build(BuildContext context) {
    final job = widget.job;
    final expired = _isExpired;
    final secs = _secondsLeft;
    return Opacity(
      opacity: expired ? 0.6 : 1,
      child: AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('New delivery', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: BB.ink)),
                const SizedBox(height: 2),
                Text('${jobLabel(job)} · ${tripLabel(job)} trip',
                    style: const TextStyle(fontSize: 12, color: BB.sub)),
              ]),
            ),
            Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
              Text(money(jobPayMinor(job)),
                  style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: BB.greenDeep)),
              const Text('You earn', style: TextStyle(fontSize: 10.5, color: BB.sub)),
            ]),
          ]),
          const SizedBox(height: 12),
          _stop(BB.green, storeName(job), storeAddress(job)),
          Padding(
            padding: const EdgeInsets.only(left: 4),
            child: Container(width: 2, height: 12, color: BB.line),
          ),
          _stop(BB.blue, receiverName(job), dropAddress(job)),
          const SizedBox(height: 10),
          Wrap(spacing: 6, runSpacing: 6, children: [
            RiderPill(icon: Icons.navigation_outlined, label: tripLabel(job)),
            PaymentPill(job: job),
            if (isCod(job))
              RiderPill(
                icon: Icons.payments_outlined,
                label: 'Collect ${money(job.cashToCollectMinor)}',
                bg: BB.amberTint,
                fg: BB.amber,
              ),
            if (job.tipMinor > 0)
              RiderPill(icon: Icons.card_giftcard, label: '${money(job.tipMinor)} tip'),
          ]),
          const SizedBox(height: 12),
          Row(children: [
            _countdownRing(),
            const SizedBox(width: 10),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(expired ? 'Offer expired' : 'Accept within ${secs}s',
                    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: BB.ink)),
                const Text('Offers go to the next rider when the timer runs out.',
                    style: TextStyle(fontSize: 11, color: BB.sub)),
              ]),
            ),
          ]),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: expired || _busy.isNotEmpty ? null : _decline,
                icon: _busy == 'decline'
                    ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.close, size: 16),
                label: const Text('Decline'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: ElevatedButton.icon(
                onPressed: expired || _busy.isNotEmpty ? null : _accept,
                icon: _busy == 'accept'
                    ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.check, size: 16),
                label: Text(_busy == 'accept' ? 'Accepting…' : 'Accept'),
              ),
            ),
          ]),
        ]),
      ),
    );
  }
}

/// Tappable active-delivery card (web activeCard mirror).
class ActiveJobCard extends StatelessWidget {
  final Job job;
  const ActiveJobCard({super.key, required this.job});
  @override
  Widget build(BuildContext context) => AppCard(
        onTap: () => openJobDetail(context, job.id),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(
              child: Text(jobLabel(job),
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: BB.ink)),
            ),
            JobStatusChip(status: job.status),
          ]),
          const SizedBox(height: 8),
          Row(children: [
            const Icon(Icons.storefront_outlined, size: 15, color: BB.greenDark),
            const SizedBox(width: 5),
            Flexible(
              child: Text(storeName(job), maxLines: 1, overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: BB.ink)),
            ),
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 5),
              child: Icon(Icons.arrow_forward, size: 13, color: BB.faint),
            ),
            const Icon(Icons.home_outlined, size: 15, color: BB.blue),
            const SizedBox(width: 5),
            Flexible(
              child: Text(receiverName(job), maxLines: 1, overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: BB.ink)),
            ),
          ]),
          const SizedBox(height: 10),
          Row(children: [
            Text(money(jobPayMinor(job)),
                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: BB.greenDeep)),
            const Spacer(),
            PaymentPill(job: job),
            if (isCod(job)) ...[
              const SizedBox(width: 6),
              RiderPill(icon: Icons.payments_outlined, label: money(job.cashToCollectMinor), bg: BB.amberTint, fg: BB.amber),
            ],
            const SizedBox(width: 4),
            const Icon(Icons.chevron_right, size: 20, color: BB.faint),
          ]),
        ]),
      );
}

/// Compact completed-delivery row (web pastRow / historyRow mirror).
class PastJobRow extends StatelessWidget {
  final Job job;
  final bool showTip;
  const PastJobRow({super.key, required this.job, this.showTip = false});
  @override
  Widget build(BuildContext context) {
    final deliveredAt = jobField(job, 'delivered_at');
    final sub = [
      if (deliveredAt.isNotEmpty) dateTime(deliveredAt),
      if (storeName(job) != 'Store') storeName(job),
      if (showTip && isCod(job)) 'COD',
    ].join(' · ');
    return AppCard(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
      onTap: () => openJobDetail(context, job.id),
      child: Row(children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(jobLabel(job), style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, color: BB.ink)),
            if (sub.isNotEmpty) ...[
              const SizedBox(height: 2),
              Text(sub, maxLines: 1, overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 11.5, color: BB.sub)),
            ],
          ]),
        ),
        const SizedBox(width: 8),
        Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Text('+${money(jobPayMinor(job))}',
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: BB.saveInk)),
          if (showTip && job.tipMinor > 0) ...[
            const SizedBox(height: 3),
            RiderPill(icon: Icons.card_giftcard, label: money(job.tipMinor)),
          ],
        ]),
      ]),
    );
  }
}