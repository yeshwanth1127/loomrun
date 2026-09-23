import 'package:flutter/foundation.dart';

import '../../core/api/api_exception.dart';
import 'leads_repository.dart';
import 'models/lead.dart';

/// Active filter state for the Leads screen.
class LeadFilters {
  final String query;
  final LeadSource? source;
  final LeadStage? stage;
  final int? scoreMin;
  final int? scoreMax;
  final bool showClosed;

  const LeadFilters({
    this.query = '',
    this.source,
    this.stage,
    this.scoreMin,
    this.scoreMax,
    this.showClosed = false,
  });

  LeadFilters copyWith({
    String? query,
    LeadSource? source,
    LeadStage? stage,
    int? scoreMin,
    int? scoreMax,
    bool? showClosed,
    bool clearSource = false,
    bool clearStage = false,
    bool clearScoreMin = false,
    bool clearScoreMax = false,
  }) {
    return LeadFilters(
      query: query ?? this.query,
      source: clearSource ? null : (source ?? this.source),
      stage: clearStage ? null : (stage ?? this.stage),
      scoreMin: clearScoreMin ? null : (scoreMin ?? this.scoreMin),
      scoreMax: clearScoreMax ? null : (scoreMax ?? this.scoreMax),
      showClosed: showClosed ?? this.showClosed,
    );
  }

  bool get hasAdvanced =>
      source != null ||
      stage != null ||
      scoreMin != null ||
      scoreMax != null;
}

/// Lead store backed by the Loomrun API (same DB as the web app).
class LeadsController extends ChangeNotifier {
  LeadsController({LeadsRepository? repository})
      : _repository = repository ?? leadsRepository;

  final LeadsRepository _repository;
  final List<Lead> _leads = [];
  LeadFilters _filters = const LeadFilters();
  bool _loading = false;
  String? _error;
  bool _loadedOnce = false;

  LeadFilters get filters => _filters;
  bool get loading => _loading;
  String? get error => _error;
  bool get loadedOnce => _loadedOnce;

  List<Lead> get all => List.unmodifiable(_leads);

  int get totalCount => _leads.length;

  int get closedCount => _leads.where((l) => l.stage.isClosed).length;

  /// Stages visible on the board, honouring the "Show closed" toggle.
  List<LeadStage> get visibleStages => _filters.showClosed
      ? LeadStage.values
      : LeadStage.open;

  void setFilters(LeadFilters filters) {
    _filters = filters;
    notifyListeners();
  }

  /// Fetch leads from the backend. Safe to call repeatedly.
  Future<void> refresh({bool silent = false}) async {
    if (!silent) {
      _loading = true;
      _error = null;
      notifyListeners();
    }
    try {
      final items = await _repository.list(
        search: _filters.query.isEmpty ? null : _filters.query,
        source: _filters.source,
        scoreMin: _filters.scoreMin,
        scoreMax: _filters.scoreMax,
      );
      _leads
        ..clear()
        ..addAll(items);
      _error = null;
      _loadedOnce = true;
    } on ApiException catch (e) {
      _error = e.message;
    } catch (e) {
      _error = e.toString();
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  /// Leads matching the active filters (client-side stage/closed filtering).
  List<Lead> filtered({LeadStage? stage}) {
    final q = _filters.query.trim().toLowerCase();
    return _leads.where((lead) {
      if (stage != null) {
        if (lead.stage != stage) return false;
      } else {
        if (_filters.stage != null && lead.stage != _filters.stage) {
          return false;
        }
        if (!_filters.showClosed &&
            _filters.stage == null &&
            lead.stage.isClosed) {
          return false;
        }
      }
      if (q.isNotEmpty &&
          !lead.name.toLowerCase().contains(q) &&
          !lead.company.toLowerCase().contains(q) &&
          !lead.phone.toLowerCase().contains(q)) {
        return false;
      }
      if (_filters.source != null && lead.source != _filters.source) {
        return false;
      }
      if (_filters.scoreMin != null && lead.score < _filters.scoreMin!) {
        return false;
      }
      if (_filters.scoreMax != null && lead.score > _filters.scoreMax!) {
        return false;
      }
      return true;
    }).toList()
      ..sort((a, b) => b.score.compareTo(a.score));
  }

  int countForStage(LeadStage stage) => filtered(stage: stage).length;

  double valueForStage(LeadStage stage) =>
      filtered(stage: stage).fold(0, (sum, lead) => sum + lead.value);

  Future<Lead?> createLead({
    required String name,
    required String company,
    required String phone,
    required String location,
    required LeadSource source,
    required LeadStage stage,
    required double value,
    String? notes,
  }) async {
    try {
      final created = await _repository.create(
        title: name,
        company: company,
        phone: phone,
        city: location,
        source: source,
        stage: stage,
        estimatedValue: value,
        notes: notes,
      );
      _leads.insert(0, created);
      notifyListeners();
      return created;
    } on ApiException catch (e) {
      _error = e.message;
      notifyListeners();
      return null;
    }
  }

  /// Legacy local insert used by tests / offline stubs.
  void add(Lead lead) {
    _leads.insert(0, lead);
    notifyListeners();
  }

  Future<void> moveToStage(String leadId, LeadStage stage) async {
    final i = _leads.indexWhere((l) => l.id == leadId);
    if (i == -1) return;
    final previous = _leads[i];
    _leads[i] = previous.copyWith(stage: stage);
    notifyListeners();
    try {
      final updated = await _repository.update(leadId, stage: stage);
      final j = _leads.indexWhere((l) => l.id == leadId);
      if (j != -1) {
        _leads[j] = updated;
        notifyListeners();
      }
    } on ApiException catch (e) {
      _leads[i] = previous;
      _error = e.message;
      notifyListeners();
    }
  }

  Future<void> scheduleFollowUp(
    String leadId,
    DateTime when, {
    String? notes,
  }) async {
    final updated = await _repository.update(
      leadId,
      nextFollowUpAt: when,
      notes: notes,
    );
    final i = _leads.indexWhere((l) => l.id == leadId);
    if (i == -1) {
      _leads.insert(0, updated);
    } else {
      _leads[i] = updated;
    }
    notifyListeners();
  }

  @visibleForTesting
  void debugReplaceAll(List<Lead> leads) {
    _leads
      ..clear()
      ..addAll(leads);
    _loadedOnce = true;
    _loading = false;
    _error = null;
    notifyListeners();
  }
}

final leadsController = LeadsController();
