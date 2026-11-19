// Audit trail: newest-first ledger of privileged actions. Rows carry actor,
// action, entity · entity_id, a defensive detail summary and relative time.
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'admin_models.dart';
import 'admin_providers.dart';
import 'admin_shared.dart';

const _limits = [50, 100, 200, 500];
const _moneyKeys = {'total', 'grand_total', 'amount', 'refund'};

String _shortId(String id) => id.length > 20 ? '${id.substring(0, 20)}…' : id;

/// Mirrors the web detailSummary: parse the JSON detail string defensively,
/// render *_minor / money keys as ₹, booleans as yes/no, objects as ellipsis.
String _detailSummary(String raw) {
  if (raw.isEmpty) return '';
  dynamic parsed;
  try {
    parsed = jsonDecode(raw);
  } catch (_) {
    return raw.length > 160 ? '${raw.substring(0, 160)}…' : raw;
  }
  if (parsed is! Map) return '$parsed';
  final parts = <String>[];
  for (final entry in parsed.entries.take(6)) {
    final key = '${entry.key}';
    final value = entry.value;
    final label = key.replaceAll(RegExp(r'_minor$'), '').replaceAll('_', ' ');
    if (key.endsWith('_minor') || _moneyKeys.contains(key)) {
      parts.add('$label: ${money(value is num ? value : num.tryParse('$value') ?? 0)}');
    } else if (value is bool) {
      parts.add('$label: ${value ? 'yes' : 'no'}');
    } else if (value is Map || value is List) {
      parts.add('$label: …');
    } else {
      parts.add('$label: $value');
    }
  }
  final summary = parts.join(' · ');
  return summary.length > 180 ? '${summary.substring(0, 180)}…' : summary;
}

class AuditScreen extends ConsumerStatefulWidget {
  const AuditScreen({super.key});
  @override
  ConsumerState<AuditScreen> createState() => _AuditScreenState();
}

class _AuditScreenState extends ConsumerState<AuditScreen> {
  int _limit = 100;

  @override
  Widget build(BuildContext context) {
    final auditAsync = ref.watch(adminAuditProvider(_limit));
    final users = ref.watch(adminUsersProvider).valueOrNull ?? const [];
    String actorName(String id) {
      for (final row in users) {
        if (row.user.id == id) return row.user.name;
      }
      return '';
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Audit log'), actions: [
        RefreshAction(onPressed: () => ref.invalidate(adminAuditProvider)),
      ]),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 6),
          child: Row(children: [
            const Expanded(
              child: Text('Every privileged action, newest first', style: TextStyle(fontSize: 12, color: BB.sub)),
            ),
            DropdownButton<int>(
              value: _limit,
              underline: const SizedBox.shrink(),
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: BB.greenDeep),
              items: [for (final n in _limits) DropdownMenuItem(value: n, child: Text('Last $n'))],
              onChanged: (v) => setState(() => _limit = v ?? 100),
            ),
          ]),
        ),
        Expanded(
          child: auditAsync.when(
            loading: () => const LoadingView(),
            error: (e, _) => ErrorView(
              message: adminErrorMessage(e, 'Could not load the audit log'),
              onRetry: () => ref.invalidate(adminAuditProvider(_limit)),
            ),
            data: (events) {
              if (events.isEmpty) {
                return const EmptyState(
                  icon: Icons.shield_rounded,
                  title: 'No audit events',
                  subtitle: 'Privileged actions — store edits, staff changes, coupons and cancellations — are recorded here.',
                );
              }
              return RefreshIndicator(
                color: BB.green,
                onRefresh: () async => ref.refresh(adminAuditProvider(_limit).future),
                child: ListView.separated(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                  itemCount: events.length + 1,
                  separatorBuilder: (_, __) => const SizedBox(height: 8),
                  itemBuilder: (context, index) {
                    if (index == 0) {
                      return Text('${events.length} event${events.length == 1 ? '' : 's'} · newest first',
                          style: const TextStyle(fontSize: 11.5, color: BB.faint));
                    }
                    final event = events[index - 1];
                    return _AuditRow(event: event, actorName: actorName(rawString(event['actor_id'])));
                  },
                ),
              );
            },
          ),
        ),
      ]),
    );
  }
}

class _AuditRow extends StatelessWidget {
  final Map<String, dynamic> event;
  final String actorName;
  const _AuditRow({required this.event, required this.actorName});

  @override
  Widget build(BuildContext context) {
    final actorId = rawString(event['actor_id']);
    final summary = _detailSummary(rawString(event['detail']));
    final createdAt = rawString(event['created_at']);
    return AppCard(
      padding: const EdgeInsets.all(12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(
            child: Text(rawString(event['action']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: BB.ink)),
          ),
          Text(relativeTime(createdAt), style: const TextStyle(fontSize: 11, color: BB.faint)),
        ]),
        const SizedBox(height: 3),
        Text(
          '${actorName.isEmpty ? _shortId(actorId) : actorName} · ${rawString(event['entity'])} · ${_shortId(rawString(event['entity_id']))}',
          style: const TextStyle(fontSize: 11.5, color: BB.sub),
        ),
        if (summary.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(summary, style: const TextStyle(fontSize: 11.5, color: BB.faint, height: 1.35)),
          ),
        if (createdAt.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(dateTime(createdAt), style: const TextStyle(fontSize: 10.5, color: BB.faint)),
          ),
      ]),
    );
  }
}