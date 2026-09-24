import 'package:flutter/material.dart';

import '../../core/api/api_client.dart';
import '../../core/api/api_exception.dart';
import '../../core/auth/auth.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_typography.dart';

/// One website settings section, loaded from the same org APIs.
class SettingsSectionPage extends StatefulWidget {
  const SettingsSectionPage({
    super.key,
    required this.sectionId,
    required this.title,
  });

  final String sectionId;
  final String title;

  @override
  State<SettingsSectionPage> createState() => _SettingsSectionPageState();
}

class _SettingsSectionPageState extends State<SettingsSectionPage> {
  bool _loading = true;
  String? _error;
  Map<String, dynamic> _data = {};

  final _brand = <String, TextEditingController>{};
  bool _savingBrand = false;
  bool _autoGreet = true;
  bool _savingGreet = false;

  static const _brandFields = <(String, String)>[
    ('legal_name', 'Legal name'),
    ('address', 'Address'),
    ('phone', 'Phone'),
    ('email', 'Email'),
    ('website', 'Website'),
    ('tax_id', 'Tax ID'),
    ('bank_name', 'Bank name'),
    ('bank_account_name', 'Account name'),
    ('bank_account_number', 'Account number'),
    ('bank_ifsc', 'IFSC'),
    ('bank_swift', 'SWIFT'),
    ('bank_ad_code', 'AD code'),
    ('bank_branch', 'Branch'),
  ];

  String? get _orgId => authController.activeOrgId;

  @override
  void initState() {
    super.initState();
    for (final field in _brandFields) {
      _brand[field.$1] = TextEditingController();
    }
    _load();
  }

  @override
  void dispose() {
    for (final controller in _brand.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<Map<String, dynamic>> _get(String path) async {
    return apiClient.get<Map<String, dynamic>>(path);
  }

  Future<void> _load() async {
    final orgId = _orgId;
    if (orgId == null) {
      setState(() {
        _loading = false;
        _error = 'No organization selected.';
      });
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = switch (widget.sectionId) {
        'connections' => await _loadConnections(orgId),
        'whatsapp' => await _loadWhatsApp(orgId),
        'calling' => await _get('/v1/orgs/$orgId/telephony/providers'),
        'brand' => await _get('/v1/orgs/$orgId/brand'),
        'documents' => await _get('/v1/orgs/$orgId/document-templates'),
        'team' => await _get('/v1/orgs/$orgId/members'),
        'plan' || 'usage' => await _get('/v1/orgs/$orgId/subscription'),
        _ => <String, dynamic>{},
      };
      if (!mounted) return;
      if (widget.sectionId == 'brand') {
        for (final field in _brandFields) {
          _brand[field.$1]!.text = (data[field.$1] as String?) ?? '';
        }
      }
      if (widget.sectionId == 'whatsapp') {
        _autoGreet = data['auto_greet_new_leads'] == true;
      }
      setState(() {
        _data = data;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
    }
  }

  Future<Map<String, dynamic>> _tryGet(String path) async {
    try {
      return await _get(path);
    } on ApiException catch (e) {
      return {'_error': e.message};
    }
  }

  Future<Map<String, dynamic>> _loadConnections(String orgId) async {
    final results = await Future.wait([
      _tryGet('/v1/orgs/$orgId/lead-connections'),
      _tryGet('/v1/orgs/$orgId/google/connections'),
      _tryGet('/v1/orgs/$orgId/automation-connections'),
    ]);
    return {
      'lead_sources': results[0]['items'] ?? const [],
      'google': results[1]['items'] ?? const [],
      'automations': results[2]['items'] ?? const [],
      'notes': [
        for (final result in results)
          if (result['_error'] != null) result['_error'],
      ],
    };
  }

  Future<Map<String, dynamic>> _loadWhatsApp(String orgId) async {
    final status = await _tryGet('/v1/orgs/$orgId/connectors/whatsapp');
    final settings = await _tryGet(
      '/v1/orgs/$orgId/integrations/whatsapp/settings',
    );
    final templates = await _tryGet(
      '/v1/orgs/$orgId/integrations/whatsapp/templates',
    );
    return {
      ...status,
      if (settings['auto_greet_new_leads'] != null)
        'auto_greet_new_leads': settings['auto_greet_new_leads'],
      'templates': templates['items'] ?? const [],
      'notes': [
        if (status['_error'] != null) status['_error'],
        if (settings['_error'] != null) settings['_error'],
        if (templates['_error'] != null) templates['_error'],
      ],
    };
  }

  Future<void> _saveBrand() async {
    final orgId = _orgId;
    if (orgId == null || _savingBrand) return;
    setState(() => _savingBrand = true);
    try {
      final body = {
        for (final field in _brandFields)
          field.$1: _brand[field.$1]!.text.trim().isEmpty
              ? null
              : _brand[field.$1]!.text.trim(),
      };
      await apiClient.patch<Map<String, dynamic>>(
        '/v1/orgs/$orgId/brand',
        json: body,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Brand saved')));
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _savingBrand = false);
    }
  }

  Future<void> _saveGreet(bool value) async {
    final orgId = _orgId;
    if (orgId == null) return;
    setState(() {
      _autoGreet = value;
      _savingGreet = true;
    });
    try {
      await apiClient.patch<Map<String, dynamic>>(
        '/v1/orgs/$orgId/integrations/whatsapp/settings',
        json: {'auto_greet_new_leads': value},
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _autoGreet = !value);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _savingGreet = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surface,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.onSurface,
        elevation: 0,
        title: Text(widget.title, style: AppTypography.heading(fontSize: 20)),
      ),
      body: _loading
          ? const Center(
              child: CircularProgressIndicator(color: AppColors.primary),
            )
          : _error != null
          ? _ErrorState(message: _error!, onRetry: _load)
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
                children: _body(),
              ),
            ),
    );
  }

  List<Widget> _body() {
    return switch (widget.sectionId) {
      'connections' => _connections(),
      'whatsapp' => _whatsapp(),
      'calling' => _calling(),
      'brand' => _brandForm(),
      'documents' => _documents(),
      'team' => _team(),
      'plan' => _plan(),
      'usage' => _usage(),
      _ => const [Text('Unknown section')],
    };
  }

  List<Widget> _connections() {
    final leads = _items(_data['lead_sources']);
    final google = _items(_data['google']);
    final automations = _items(_data['automations']);
    return [
      const _Note(
        'Connection status matches the website. Signing in with Meta or Google still happens there.',
      ),
      for (final note in _items(_data['notes'])) _Note('$note'),
      const _SectionLabel('Lead sources'),
      if (leads.isEmpty) const _Empty('No lead sources yet.'),
      for (final item in leads)
        _StatusRow(
          title: _text(item, 'label', fallback: _text(item, 'source_name')),
          detail: _text(item, 'status'),
          trailing: item['leads_count'] == null
              ? null
              : '${item['leads_count']} leads',
        ),
      const _SectionLabel('Google'),
      if (google.isEmpty) const _Empty('Google is not connected.'),
      for (final item in google)
        _StatusRow(
          title: _text(item, 'label', fallback: _text(item, 'service_name')),
          detail: _text(item, 'status'),
          trailing: item['connected_email'] as String?,
        ),
      const _SectionLabel('Automations'),
      if (automations.isEmpty) const _Empty('No automations yet.'),
      for (final item in automations)
        _StatusRow(
          title: _text(
            item,
            'label',
            fallback: _text(item, 'service_name', fallback: 'Automation'),
          ),
          detail: _text(item, 'status'),
        ),
    ];
  }

  List<Widget> _whatsapp() {
    final templates = _items(_data['templates']);
    final phone = _data['phone_number'] as String?;
    return [
      for (final note in _items(_data['notes'])) _Note('$note'),
      _StatusRow(
        title: 'WhatsApp',
        detail: _text(
          _data,
          'status',
          fallback: _data['connected'] == true ? 'connected' : 'disconnected',
        ),
        trailing: phone,
      ),
      _Panel(
        child: SwitchListTile(
          contentPadding: const EdgeInsets.symmetric(horizontal: 14),
          title: const Text('Greet new leads'),
          subtitle: const Text('Send the welcome message when a lead arrives.'),
          value: _autoGreet,
          activeThumbColor: AppColors.primary,
          onChanged: _savingGreet ? null : _saveGreet,
        ),
      ),
      const _SectionLabel('Templates'),
      if (templates.isEmpty) const _Empty('No WhatsApp templates yet.'),
      for (final item in templates)
        _StatusRow(title: _text(item, 'name'), detail: _text(item, 'category')),
    ];
  }

  List<Widget> _calling() {
    final providers = _items(_data['providers']);
    if (providers.isEmpty) return const [_Empty('No calling providers yet.')];
    return [
      for (final item in providers)
        _StatusRow(
          title: _text(item, 'label', fallback: _text(item, 'provider_name')),
          detail: _text(item, 'status'),
          trailing: item['phone_number'] as String?,
        ),
    ];
  }

  List<Widget> _brandForm() {
    return [
      if (_data['has_logo'] == true) const _Note('A logo is uploaded.'),
      if (_data['has_signature'] == true)
        const _Note('A signature is uploaded.'),
      if (_data['has_upi_qr'] == true) const _Note('A UPI QR is uploaded.'),
      _Panel(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 14, 14, 4),
          child: Column(
            children: [
              for (final field in _brandFields) ...[
                TextField(
                  controller: _brand[field.$1],
                  minLines: field.$1 == 'address' ? 2 : 1,
                  maxLines: field.$1 == 'address' ? 4 : 1,
                  decoration: InputDecoration(
                    labelText: field.$2,
                    isDense: true,
                    filled: true,
                    fillColor: AppColors.surface,
                    border: const OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
              ],
            ],
          ),
        ),
      ),
      const SizedBox(height: 4),
      FilledButton(
        onPressed: _savingBrand ? null : _saveBrand,
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.primary,
          minimumSize: const Size.fromHeight(46),
        ),
        child: Text(_savingBrand ? 'Saving…' : 'Save brand'),
      ),
    ];
  }

  List<Widget> _documents() {
    final items = _items(_data['items']);
    final quoteDefault = _data['default_quotation_template_id'] as String?;
    final invoiceDefault = _data['default_invoice_template_id'] as String?;
    if (items.isEmpty) return const [_Empty('No document templates yet.')];
    return [
      for (final item in items)
        _StatusRow(
          title: _text(item, 'name'),
          detail: _text(item, 'doc_type'),
          trailing:
              item['id'] == quoteDefault ||
                  item['id'] == invoiceDefault ||
                  item['is_default'] == true
              ? 'Default'
              : null,
        ),
    ];
  }

  List<Widget> _team() {
    final items = _items(_data['items']);
    if (items.isEmpty) return const [_Empty('No people yet.')];
    return [
      for (final item in items)
        _StatusRow(
          title: _text(item, 'name', fallback: _text(item, 'email')),
          detail: _text(item, 'role'),
          trailing: item['email'] as String?,
        ),
    ];
  }

  List<Widget> _plan() {
    final trial = _data['trial'];
    final seats = _data['seats'];
    final catalog = _items(_data['catalog']);
    final daysLeft = trial is Map ? trial['days_left'] : null;
    return [
      _StatusRow(
        title: _text(_data, 'plan_label', fallback: _text(_data, 'plan')),
        detail: _text(_data, 'status'),
        trailing: daysLeft == null ? null : '$daysLeft days left',
      ),
      if (seats is Map)
        _StatusRow(
          title: 'Seats',
          detail: '${seats['used'] ?? 0} of ${seats['limit'] ?? '—'} used',
        ),
      const _SectionLabel('Plans'),
      for (final plan in catalog) ...[
        Text(
          '${_text(plan, 'name')} · ${_text(plan, 'price_label')}',
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 4),
        for (final feature in _items(plan['features']))
          Padding(
            padding: const EdgeInsets.only(bottom: 2),
            child: Text(
              '· $feature',
              style: const TextStyle(fontSize: 13, height: 1.35),
            ),
          ),
        const SizedBox(height: 12),
      ],
    ];
  }

  List<Widget> _usage() {
    final usage = _data['usage'];
    if (usage is! Map) return const [_Empty('No usage recorded yet.')];
    final wa = usage['whatsapp_outbound'];
    final ai = usage['ai'];
    final session = ai is Map ? ai['session5h'] : null;
    final weekly = ai is Map ? ai['weekly'] : null;
    return [
      if (wa is Map)
        _UsageBar(
          label: 'WhatsApp messages today',
          used: _num(wa['used']),
          limit: wa['limit'] == null ? null : _num(wa['limit']),
        ),
      if (session is Map)
        _UsageBar(
          label: 'AI credits · 5 hours',
          used: _num(session['used']),
          limit: session['limit'] == null ? null : _num(session['limit']),
          resetsAt: session['resetsAt'] as String?,
        ),
      if (weekly is Map)
        _UsageBar(
          label: 'AI credits · this week',
          used: _num(weekly['used']),
          limit: weekly['limit'] == null ? null : _num(weekly['limit']),
          resetsAt: weekly['resetsAt'] as String?,
        ),
    ];
  }
}

List<dynamic> _items(Object? value) {
  if (value is List) return value;
  return const [];
}

String _text(Object? source, String key, {String fallback = '—'}) {
  if (source is! Map) return fallback;
  final value = source[key];
  if (value == null) return fallback;
  final text = value.toString().trim();
  return text.isEmpty ? fallback : text;
}

int _num(Object? value) {
  if (value is num) return value.round();
  return int.tryParse('$value') ?? 0;
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 16, bottom: 6),
      child: Text(
        text.toUpperCase(),
        style: const TextStyle(
          fontSize: 11,
          letterSpacing: 0.6,
          fontWeight: FontWeight.w600,
          color: AppColors.outline,
        ),
      ),
    );
  }
}

class _Panel extends StatelessWidget {
  const _Panel({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: AppColors.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.outlineVariant),
      ),
      child: child,
    );
  }
}

class _StatusRow extends StatelessWidget {
  const _StatusRow({required this.title, required this.detail, this.trailing});

  final String title;
  final String detail;
  final String? trailing;

  @override
  Widget build(BuildContext context) {
    return _Panel(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    detail,
                    style: const TextStyle(
                      fontSize: 13,
                      color: AppColors.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
            if (trailing != null && trailing!.isNotEmpty)
              Flexible(
                child: Text(
                  trailing!,
                  textAlign: TextAlign.right,
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppColors.onSurfaceVariant,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _UsageBar extends StatelessWidget {
  const _UsageBar({
    required this.label,
    required this.used,
    required this.limit,
    this.resetsAt,
  });

  final String label;
  final int used;
  final int? limit;
  final String? resetsAt;

  @override
  Widget build(BuildContext context) {
    final capped = limit != null && limit! > 0;
    final pct = capped ? ((used / limit!) * 100).clamp(0, 100).round() : null;
    return _Panel(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    label,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
                Text(
                  pct == null ? 'Unlimited' : '$pct%',
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppColors.onSurfaceVariant,
                  ),
                ),
              ],
            ),
            if (capped) ...[
              const SizedBox(height: 6),
              ClipRRect(
                borderRadius: BorderRadius.circular(99),
                child: LinearProgressIndicator(
                  value: (pct! / 100).clamp(0, 1),
                  minHeight: 6,
                  backgroundColor: AppColors.surfaceContainer,
                  color: pct >= 90 ? AppColors.error : AppColors.primary,
                ),
              ),
            ],
            if (resetsAt != null && resetsAt!.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  'Resets $resetsAt',
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppColors.onSurfaceVariant,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _Note extends StatelessWidget {
  const _Note(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return _Panel(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Text(
          text,
          style: const TextStyle(
            fontSize: 13,
            height: 1.4,
            color: AppColors.onSurfaceVariant,
          ),
        ),
      ),
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return _Panel(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Text(
          text,
          style: const TextStyle(color: AppColors.onSurfaceVariant),
        ),
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            TextButton(onPressed: onRetry, child: const Text('Try again')),
          ],
        ),
      ),
    );
  }
}
