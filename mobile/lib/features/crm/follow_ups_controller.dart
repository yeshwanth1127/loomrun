import 'package:flutter/foundation.dart';

import '../../core/api/api_exception.dart';
import 'follow_ups_repository.dart';
import 'models/follow_up.dart';
import 'models/lead.dart';

/// Follow-up store backed by lead follow-up fields on the API.
class FollowUpsController extends ChangeNotifier {
  FollowUpsController({FollowUpsRepository? repository})
      : _repository = repository ?? followUpsRepository;

  final FollowUpsRepository _repository;
  final List<FollowUp> _followUps = [];
  String _query = '';
  bool _loading = false;
  String? _error;
  bool _loadedOnce = false;

  String get query => _query;

  set query(String value) {
    _query = value;
    notifyListeners();
  }

  bool get loading => _loading;
  String? get error => _error;
  bool get loadedOnce => _loadedOnce;

  List<FollowUp> get all {
    final sorted = [..._followUps]
      ..sort((a, b) => a.dateTime.compareTo(b.dateTime));
    return List.unmodifiable(sorted);
  }

  int get scheduledCount => _followUps.length;

  List<FollowUp> overdue(DateTime now) =>
      all.where((f) => f.isOverdue(now)).toList();

  List<FollowUp> dueToday(DateTime now) =>
      all.where((f) => f.isDueToday(now)).toList();

  List<FollowUp> upcoming(DateTime now) =>
      all.where((f) => f.isUpcoming(now)).toList();

  int get convertedToQuotes =>
      _followUps.where((f) => f.outcome == FollowUpOutcome.quote).length;

  int get convertedToOrders =>
      _followUps.where((f) => f.outcome == FollowUpOutcome.order).length;

  int get conversionPercent {
    if (_followUps.isEmpty) return 0;
    final converted = _followUps.where((f) => f.converted).length;
    return (converted * 100 / _followUps.length).round();
  }

  List<FollowUp> forTab(FollowUpTab tab, DateTime now) {
    final base = switch (tab) {
      FollowUpTab.all => all,
      FollowUpTab.dueToday => dueToday(now),
      FollowUpTab.overdue => overdue(now),
    };
    final q = _query.trim().toLowerCase();
    if (q.isEmpty) return base;
    return base
        .where((f) =>
            f.customerName.toLowerCase().contains(q) ||
            f.company.toLowerCase().contains(q) ||
            f.phone.toLowerCase().contains(q) ||
            f.action.toLowerCase().contains(q))
        .toList();
  }

  int tabCount(FollowUpTab tab, DateTime now) => switch (tab) {
        FollowUpTab.all => _followUps.length,
        FollowUpTab.dueToday => dueToday(now).length,
        FollowUpTab.overdue => overdue(now).length,
      };

  Future<void> refresh({bool silent = false}) async {
    if (!silent) {
      _loading = true;
      _error = null;
      notifyListeners();
    }
    try {
      final items = await _repository.listWithFollowUpDate();
      _followUps
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

  Future<FollowUp?> schedule({
    required Lead lead,
    required DateTime when,
    required String action,
    String? relatedRef,
    bool highPriority = false,
  }) async {
    try {
      final scheduled = await _repository.schedule(
        lead: lead,
        when: when,
        action: action,
        relatedRef: relatedRef,
        highPriority: highPriority,
      );
      final i = _followUps.indexWhere((f) => f.leadId == scheduled.leadId);
      if (i == -1) {
        _followUps.add(scheduled);
      } else {
        _followUps[i] = scheduled;
      }
      notifyListeners();
      return scheduled;
    } on ApiException catch (e) {
      _error = e.message;
      notifyListeners();
      return null;
    }
  }

  void add(FollowUp followUp) {
    _followUps.add(followUp);
    notifyListeners();
  }

  @visibleForTesting
  void debugReplaceAll(List<FollowUp> items) {
    _followUps
      ..clear()
      ..addAll(items);
    _loadedOnce = true;
    _loading = false;
    _error = null;
    notifyListeners();
  }
}

final followUpsController = FollowUpsController();
