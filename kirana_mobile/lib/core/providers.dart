import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'api/api_client.dart';
import 'models.dart';

const _tokenKey = 'kc-v2-token';
const _storage = FlutterSecureStorage();

final apiProvider = Provider<ApiClient>((ref) => ApiClient());

enum SessionStatus { unknown, authenticated, unauthenticated }

class SessionState {
  final SessionStatus status;
  final AppUser? user;
  const SessionState({this.status = SessionStatus.unknown, this.user});
  String get role => user?.role ?? '';
  bool get isAuthenticated => status == SessionStatus.authenticated;
}

class SessionNotifier extends StateNotifier<SessionState> {
  final ApiClient _api;
  SessionNotifier(this._api) : super(const SessionState());

  Future<void> bootstrap() async {
    String? token;
    try { token = await _storage.read(key: _tokenKey); } catch (_) {}
    if (token == null || token.isEmpty) {
      state = const SessionState(status: SessionStatus.unauthenticated);
      return;
    }
    _api.token = token;
    try {
      final data = await _api.me();
      final user = AppUser.fromJson(mapFrom(data, 'user'));
      state = SessionState(status: SessionStatus.authenticated, user: user);
    } catch (_) {
      _api.token = '';
      try { await _storage.delete(key: _tokenKey); } catch (_) {}
      state = const SessionState(status: SessionStatus.unauthenticated);
    }
  }

  Future<void> completeLogin(String token, Map<String, dynamic> userData) async {
    _api.token = token;
    try { await _storage.write(key: _tokenKey, value: token); } catch (_) {}
    // Prefer /auth/me for the authoritative role; fall back to verify payload.
    AppUser user;
    try {
      final data = await _api.me();
      user = AppUser.fromJson(mapFrom(data, 'user'));
    } catch (_) {
      user = AppUser.fromJson(userData);
    }
    state = SessionState(status: SessionStatus.authenticated, user: user);
  }

  Future<void> updateName(String name) async {
    await _api.updateProfile(name);
    final u = state.user;
    if (u != null) {
      state = SessionState(status: SessionStatus.authenticated, user: AppUser(id: u.id, name: name, phone: u.phone, role: u.role, active: u.active));
    }
  }

  Future<void> logout() async {
    try { await _api.logout(); } catch (_) {}
    _api.token = '';
    try { await _storage.delete(key: _tokenKey); } catch (_) {}
    state = const SessionState(status: SessionStatus.unauthenticated);
  }
}

final sessionProvider = StateNotifierProvider<SessionNotifier, SessionState>((ref) {
  return SessionNotifier(ref.watch(apiProvider));
});

/// Selected store for the customer app (persisted in-memory; default first store).
final selectedStoreProvider = StateProvider<Store?>((ref) => null);