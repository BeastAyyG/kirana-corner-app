// People: role-filtered directory of customers and staff with suspend /
// activate actions and staff onboarding (picker / rider / admin).
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_exception.dart';
import '../../core/format.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'admin_models.dart';
import 'admin_providers.dart';
import 'admin_shared.dart';
import 'staff_form_screen.dart';

const _roleTabs = [
  ['', 'All'],
  ['customer', 'Customers'],
  ['picker', 'Pickers'],
  ['rider', 'Riders'],
  ['admin', 'Admins'],
];

class UsersScreen extends ConsumerStatefulWidget {
  const UsersScreen({super.key});
  @override
  ConsumerState<UsersScreen> createState() => _UsersScreenState();
}

class _UsersScreenState extends ConsumerState<UsersScreen> {
  String _role = '';

  int _countFor(List<AdminUserRow> users, String role) =>
      role.isEmpty ? users.length : users.where((u) => u.user.role == role).length;

  Future<void> _toggleActive(AdminUserRow row) async {
    final user = row.user;
    final suspending = user.active;
    final ok = await confirmAction(
      context,
      title: '${suspending ? 'Suspend' : 'Activate'} ${user.name.isEmpty ? 'this account' : user.name}?',
      message: suspending
          ? 'Their sessions end immediately and they cannot sign in until reactivated.'
          : 'They can sign in and work again.',
      confirmLabel: suspending ? 'Suspend' : 'Activate',
      danger: suspending,
    );
    if (!ok || !mounted) return;
    try {
      await ref.read(apiProvider).adminSetUserActive(user.id, !suspending);
      ref.invalidate(adminUsersProvider);
      ref.invalidate(adminOverviewProvider);
      if (mounted) showAdminSnack(context, suspending ? 'Account suspended' : 'Account activated');
    } catch (error) {
      if (!mounted) return;
      final message = error is ApiException && error.code == 'SELF_SUSPEND'
          ? 'You cannot suspend your own account'
          : adminErrorMessage(error, 'Could not update the account');
      showAdminSnack(context, message, isError: true);
    }
  }

  Future<void> _addStaff() async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const StaffFormScreen()));
  }

  @override
  Widget build(BuildContext context) {
    final usersAsync = ref.watch(adminUsersProvider);
    final selfId = ref.watch(sessionProvider).user?.id ?? '';
    return Column(children: [
      AdminHeading(
        title: 'People',
        subtitle: 'Customers, pickers, riders and admins',
        actions: [
          RefreshAction(onPressed: () => ref.invalidate(adminUsersProvider)),
          IconButton(
            onPressed: _addStaff,
            icon: const Icon(Icons.person_add_alt_1_rounded, color: BB.greenDark),
            tooltip: 'Add staff',
          ),
        ],
      ),
      SizedBox(
        height: 40,
        child: usersAsync.maybeWhen(
          data: (users) => ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            children: [
              for (final tab in _roleTabs)
                FilterChipButton(
                  label: '${tab[1]} · ${_countFor(users, tab[0])}',
                  selected: _role == tab[0],
                  onTap: () => setState(() => _role = tab[0]),
                ),
            ],
          ),
          orElse: () => ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            children: [
              for (final tab in _roleTabs)
                FilterChipButton(label: tab[1], selected: _role == tab[0], onTap: () => setState(() => _role = tab[0])),
            ],
          ),
        ),
      ),
      const SizedBox(height: 8),
      Expanded(
        child: usersAsync.when(
          loading: () => const LoadingView(),
          error: (e, _) => ErrorView(
            message: adminErrorMessage(e, 'Could not load users'),
            onRetry: () => ref.invalidate(adminUsersProvider),
          ),
          data: (users) {
            final list = _role.isEmpty ? users : users.where((u) => u.user.role == _role).toList();
            if (list.isEmpty) {
              return EmptyState(
                icon: Icons.group_rounded,
                title: 'No accounts in this view',
                subtitle: _role.isEmpty ? 'Accounts appear here as people sign up.' : 'No $_role accounts yet. Add staff to grow the team.',
                action: _role.isEmpty
                    ? null
                    : PrimaryButton(label: 'Add staff', icon: Icons.person_add_alt_1_rounded, onPressed: _addStaff),
              );
            }
            return RefreshIndicator(
              color: BB.green,
              onRefresh: () async => ref.refresh(adminUsersProvider.future),
              child: ListView.separated(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                itemCount: list.length + 1,
                separatorBuilder: (_, __) => const SizedBox(height: 10),
                itemBuilder: (context, index) {
                  if (index == 0) {
                    return Text('${list.length} account${list.length == 1 ? '' : 's'}', style: const TextStyle(fontSize: 11.5, color: BB.faint));
                  }
                  final row = list[index - 1];
                  final isSelf = row.user.id == selfId;
                  return _UserCard(row: row, isSelf: isSelf, onToggle: isSelf ? null : () => _toggleActive(row));
                },
              ),
            );
          },
        ),
      ),
    ]);
  }
}

class _UserCard extends StatelessWidget {
  final AdminUserRow row;
  final bool isSelf;
  final VoidCallback? onToggle;
  const _UserCard({required this.row, required this.isSelf, this.onToggle});

  static const _roleColors = {
    'customer': [BB.line, BB.sub],
    'picker': [BB.blueTint, BB.blue],
    'rider': [BB.amberTint, BB.amber],
    'admin': [BB.greenTint, BB.greenDeep],
  };

  @override
  Widget build(BuildContext context) {
    final user = row.user;
    final colors = _roleColors[user.role] ?? const [BB.line, BB.sub];
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(
            child: Text(user.name.isEmpty ? '—' : user.name, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: BB.ink)),
          ),
          if (isSelf) const Pill(label: 'You'),
          const SizedBox(width: 4),
          Pill(label: user.active ? 'Active' : 'Suspended', bg: user.active ? BB.greenTint : BB.redTint, fg: user.active ? BB.greenDeep : BB.red),
        ]),
        const SizedBox(height: 4),
        Text(phonePretty(user.phone), style: const TextStyle(fontSize: 12.5, color: BB.sub)),
        const SizedBox(height: 8),
        Row(children: [
          Pill(label: user.role.isEmpty ? 'unknown' : user.role, bg: colors[0], fg: colors[1]),
          const SizedBox(width: 8),
          if (row.createdAt.isNotEmpty)
            Expanded(child: Text('Joined ${dateTime(row.createdAt)}', style: const TextStyle(fontSize: 11, color: BB.faint))),
          if (isSelf)
            const Text('Signed in', style: TextStyle(fontSize: 11.5, color: BB.faint))
          else if (onToggle != null)
            TextButton.icon(
              onPressed: onToggle,
              style: TextButton.styleFrom(
                foregroundColor: user.active ? BB.red : BB.greenDark,
                padding: const EdgeInsets.symmetric(horizontal: 8),
              ),
              icon: Icon(user.active ? Icons.block_rounded : Icons.check_circle_rounded, size: 15),
              label: Text(user.active ? 'Suspend' : 'Activate', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
            ),
        ]),
      ]),
    );
  }
}