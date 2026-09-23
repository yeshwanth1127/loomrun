import '../../core/api/api_client.dart';
import '../../core/auth/auth.dart';
import 'leads_repository.dart';
import 'models/follow_up.dart';
import 'models/lead.dart';

/// Follow-ups are leads with a scheduled callback — same approach as the web
/// FollowUpsPage (`last_call_outcome=CALLBACK_SCHEDULED`).
class FollowUpsRepository {
  FollowUpsRepository({
    ApiClient? client,
    LeadsRepository? leads,
  })  : _client = client ?? apiClient,
        _leads = leads ?? leadsRepository;

  final ApiClient _client;
  final LeadsRepository _leads;

  static const callbackOutcomes = 'CALLBACK_SCHEDULED';

  String? get _orgId => authController.activeOrgId;

  Future<List<FollowUp>> listScheduled() async {
    final leads = await _leads.list(
      lastCallOutcome: callbackOutcomes,
      day: 'all',
      includeLastCall: true,
    );
    return leads
        .where((l) => l.nextFollowUpAt != null)
        .map(_fromLead)
        .toList()
      ..sort((a, b) => a.dateTime.compareTo(b.dateTime));
  }

  /// Also load leads that simply have `next_follow_up_at` set (scheduled from
  /// mobile / PATCH without a CALLBACK_SCHEDULED call log).
  Future<List<FollowUp>> listWithFollowUpDate() async {
    final byCallback = await listScheduled();
    final withDate = await _leads.list(
      hasFollowUp: true,
      day: 'all',
      includeLastCall: true,
    );
    final map = <String, FollowUp>{
      for (final f in byCallback) f.leadId: f,
    };
    for (final lead in withDate) {
      if (lead.nextFollowUpAt == null) continue;
      map.putIfAbsent(lead.id, () => _fromLead(lead));
    }
    return map.values.toList()
      ..sort((a, b) => a.dateTime.compareTo(b.dateTime));
  }

  Future<FollowUp> schedule({
    required Lead lead,
    required DateTime when,
    required String action,
    String? relatedRef,
    bool highPriority = false,
  }) async {
    final notes = [
      if (action.trim().isNotEmpty) action.trim(),
      if (relatedRef != null && relatedRef.trim().isNotEmpty)
        'Ref: ${relatedRef.trim()}',
      if (highPriority) 'Priority: high',
    ].join('\n');

    final updated = await _leads.update(
      lead.id,
      nextFollowUpAt: when,
      notes: notes.isEmpty ? null : notes,
    );
    return _fromLead(updated, actionOverride: action, relatedRef: relatedRef);
  }

  Future<Map<String, dynamic>> listDueReminders() async {
    final orgId = _orgId;
    if (orgId == null || orgId == 'mock-org') return const {'items': []};
    return _client.get<Map<String, dynamic>>(
      '/v1/orgs/$orgId/follow-ups/due',
    );
  }

  static FollowUp _fromLead(
    Lead lead, {
    String? actionOverride,
    String? relatedRef,
  }) {
    final action = actionOverride ??
        (lead.notes?.trim().isNotEmpty == true
            ? lead.notes!.trim().split('\n').first
            : 'Follow up');
    return FollowUp(
      id: lead.id,
      leadId: lead.id,
      customerName: lead.name,
      company: lead.company,
      phone: lead.phone,
      dateTime: lead.nextFollowUpAt ?? lead.lastActivity,
      action: action,
      relatedRef: relatedRef,
      highPriority: lead.score >= 70,
      outcome: _outcomeFromStage(lead.stage),
    );
  }

  static FollowUpOutcome _outcomeFromStage(LeadStage stage) {
    if (stage == LeadStage.won) return FollowUpOutcome.order;
    if (stage == LeadStage.quoted ||
        stage == LeadStage.negotiation ||
        stage == LeadStage.sample) {
      return FollowUpOutcome.quote;
    }
    return FollowUpOutcome.pending;
  }
}

final followUpsRepository = FollowUpsRepository();
