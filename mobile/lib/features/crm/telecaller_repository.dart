import '../../core/api/api_client.dart';
import '../../core/auth/auth.dart';
import 'follow_ups_repository.dart';
import 'models/follow_up.dart';

/// Telecaller queue + daily summary from the existing API.
class TelecallerRepository {
  TelecallerRepository({
    ApiClient? client,
    FollowUpsRepository? followUps,
  })  : _client = client ?? apiClient,
        _followUps = followUps ?? followUpsRepository;

  final ApiClient _client;
  final FollowUpsRepository _followUps;

  String? get _orgId => authController.activeOrgId;

  /// Call queue = overdue + due-today follow-ups (same UX as the mobile shell).
  Future<List<FollowUp>> callQueue() async {
    final all = await _followUps.listWithFollowUpDate();
    final now = DateTime.now();
    return [
      ...all.where((f) => f.isOverdue(now)),
      ...all.where((f) => f.isDueToday(now)),
    ];
  }

  Future<Map<String, dynamic>> dailySummary({String day = 'all'}) async {
    final orgId = _orgId;
    if (orgId == null || orgId == 'mock-org') {
      return const {'total_calls': 0, 'by_outcome': {}, 'calls': []};
    }
    return _client.get<Map<String, dynamic>>(
      '/v1/orgs/$orgId/telecaller/daily-summary',
      query: {'day': day},
    );
  }

  Future<Map<String, dynamic>> logCall({
    required String leadId,
    required String outcome,
    String? notes,
    int? durationSeconds,
    DateTime? nextCallAt,
  }) async {
    final orgId = _orgId;
    if (orgId == null) {
      throw StateError('No active organization. Log in again.');
    }
    return _client.post<Map<String, dynamic>>(
      '/v1/orgs/$orgId/telecaller/calls',
      json: {
        'lead_id': leadId,
        'outcome': outcome,
        if (notes != null) 'notes': notes,
        if (durationSeconds != null) 'duration_seconds': durationSeconds,
        if (nextCallAt != null)
          'next_call_at': nextCallAt.toUtc().toIso8601String(),
      },
    );
  }
}

final telecallerRepository = TelecallerRepository();
