import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../../core/api/api_client.dart';
import '../../core/api/api_exception.dart';
import '../../core/auth/auth.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_typography.dart';

class _PendingAction {
  _PendingAction({required this.id, required this.summary});

  final String id;
  final String summary;
  String state = 'pending';
}

class _ChatMessage {
  _ChatMessage({
    required this.role,
    required this.content,
    List<_PendingAction>? actions,
  }) : actions = actions ?? [];

  final String role;
  String content;
  final List<_PendingAction> actions;
}

/// Org Ask AI — ChatGPT-like layout for the Loomrun assistant.
class AskAiScreen extends StatefulWidget {
  const AskAiScreen({super.key});

  @override
  State<AskAiScreen> createState() => _AskAiScreenState();
}

class _AskAiScreenState extends State<AskAiScreen>
    with SingleTickerProviderStateMixin {
  final _input = TextEditingController();
  final _focus = FocusNode();
  final _scroll = ScrollController();
  final List<_ChatMessage> _messages = [];

  String? _conversationId;
  String? _runId;
  String? _model;
  String _streaming = '';
  final List<_PendingAction> _streamingActions = [];
  bool _busy = false;
  String? _statusNote;
  http.Client? _streamClient;
  late final AnimationController _pulse;

  static const _prompts = [
    ('What needs my attention today?', Icons.wb_sunny_outlined),
    ('Summarize new leads', Icons.person_add_alt_outlined),
    ('Which follow-ups are overdue?', Icons.event_busy_outlined),
    ('Draft a follow-up message', Icons.edit_note_outlined),
  ];

  @override
  void initState() {
    super.initState();
    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    );
    _input.addListener(() {
      if (mounted) setState(() {});
    });
    _loadStatus();
  }

  @override
  void dispose() {
    _pulse.dispose();
    _streamClient?.close();
    _input.dispose();
    _focus.dispose();
    _scroll.dispose();
    super.dispose();
  }

  String? get _orgId => authController.activeOrgId;

  Future<void> _loadStatus() async {
    final orgId = _orgId;
    if (orgId == null) return;
    try {
      final data = await apiClient.get<Map<String, dynamic>>(
        '/v1/orgs/$orgId/ai/status',
      );
      final models = data['models'];
      String? model;
      if (models is Map) {
        model = models['default'] as String?;
      }
      if (!mounted) return;
      setState(() {
        _model = model;
        final available = data['available'] == true;
        _statusNote = available
            ? null
            : (data['upgrade_required'] == true
                ? 'AI is locked until the plan is renewed.'
                : 'AI is not available on this plan.');
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _statusNote = e.message);
    }
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.animateTo(
        _scroll.position.maxScrollExtent,
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOut,
      );
    });
  }

  void _newChat() {
    if (_busy) return;
    setState(() {
      _messages.clear();
      _conversationId = null;
      _runId = null;
      _streaming = '';
      _streamingActions.clear();
    });
  }

  Future<void> _send([String? preset]) async {
    final text = (preset ?? _input.text).trim();
    final orgId = _orgId;
    if (text.isEmpty || orgId == null || _busy) return;

    final history = [
      for (final message in _messages)
        {'role': message.role, 'content': message.content},
    ];

    setState(() {
      _messages.add(_ChatMessage(role: 'user', content: text));
      _input.clear();
      _busy = true;
      _pulse.repeat(reverse: true);
      _streaming = '';
      _streamingActions.clear();
      _runId = null;
    });
    _scrollToEnd();

    final client = http.Client();
    _streamClient = client;
    var sawDone = false;
    try {
      await apiClient.postEventStream(
        '/v1/orgs/$orgId/ai/chat/stream',
        streamClient: client,
        json: {
          'message': text,
          'history': history,
          if (_model != null) 'model': _model,
          if (_conversationId != null) 'conversation_id': _conversationId,
        },
        onEvent: (event) {
          if (!mounted) return;
          final type = event['type'] as String? ?? '';
          setState(() {
            switch (type) {
              case 'start':
                final id = event['conversation_id'] as String?;
                if (id != null && id.isNotEmpty) _conversationId = id;
              case 'run':
                _runId = event['run_id'] as String?;
              case 'delta':
                final chunk = event['text'] as String? ?? '';
                _streaming += chunk;
              case 'pending_action':
                final action = event['action'];
                if (action is Map) {
                  final id = action['id'] as String? ?? '';
                  if (id.isNotEmpty) {
                    _streamingActions.add(
                      _PendingAction(
                        id: id,
                        summary: (action['summary'] as String?) ??
                            (action['tool'] as String?) ??
                            'Confirm this change',
                      ),
                    );
                  }
                }
              case 'error':
                _streaming = event['detail'] as String? ??
                    'The assistant stopped unexpectedly.';
              case 'done':
                sawDone = true;
                final reply = (event['reply'] as String?) ?? _streaming;
                _commitAssistant(reply);
            }
          });
          _scrollToEnd();
        },
      );
      if (!sawDone &&
          mounted &&
          (_streaming.isNotEmpty || _streamingActions.isNotEmpty)) {
        setState(() => _commitAssistant(_streaming));
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _messages.add(_ChatMessage(role: 'assistant', content: e.message));
        _streaming = '';
        _streamingActions.clear();
      });
    } catch (e) {
      if (!mounted) return;
      if (_streaming.isNotEmpty) {
        setState(() => _commitAssistant(_streaming));
      }
    } finally {
      client.close();
      if (identical(_streamClient, client)) _streamClient = null;
      if (mounted) {
        setState(() => _busy = false);
      }
      _pulse.stop();
      _scrollToEnd();
    }
  }

  void _commitAssistant(String reply) {
    _messages.add(
      _ChatMessage(
        role: 'assistant',
        content: reply,
        actions: List<_PendingAction>.from(_streamingActions),
      ),
    );
    _streaming = '';
    _streamingActions.clear();
    _runId = null;
  }

  Future<void> _stop() async {
    final orgId = _orgId;
    final runId = _runId;
    _streamClient?.close();
    if (orgId == null || runId == null || runId.isEmpty) return;
    try {
      await apiClient.post<Map<String, dynamic>>(
        '/v1/orgs/$orgId/ai/runs/stop',
        json: {'run_id': runId},
      );
    } catch (_) {}
  }

  Future<void> _decide(_PendingAction action, bool confirm) async {
    final orgId = _orgId;
    if (orgId == null || action.state != 'pending') return;
    setState(() => action.state = confirm ? 'confirming' : 'cancelling');
    final verb = confirm ? 'confirm' : 'cancel';
    try {
      await apiClient.post<Map<String, dynamic>>(
        '/v1/orgs/$orgId/ai/actions/${action.id}/$verb',
      );
      if (!mounted) return;
      setState(() => action.state = confirm ? 'confirmed' : 'cancelled');
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => action.state = 'pending');
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final showEmpty = _messages.isEmpty && !_busy;
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;

    return ColoredBox(
      color: AppColors.surface,
      child: SafeArea(
        bottom: false,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 6, 8, 4),
              child: Row(
                children: [
                  IconButton(
                    tooltip: 'New chat',
                    onPressed: _busy ? null : _newChat,
                    icon: const Icon(Icons.edit_square, size: 20),
                    color: AppColors.onSurfaceVariant,
                  ),
                  Expanded(
                    child: Column(
                      children: [
                        Text(
                          'Ask AI',
                          style: AppTypography.heading(fontSize: 22),
                        ),
                        Text(
                          'Noolrun assistant',
                          style: AppTypography.caption(fontSize: 11),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 48),
                ],
              ),
            ),
            if (_statusNote != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
                child: Text(
                  _statusNote!,
                  textAlign: TextAlign.center,
                  style: AppTypography.caption(
                    fontSize: 13,
                    color: AppColors.error,
                  ),
                ),
              ),
            Expanded(
              child: showEmpty
                  ? _EmptyChat(
                      prompts: _prompts,
                      onPrompt: (prompt) => _send(prompt),
                    )
                  : ListView(
                      controller: _scroll,
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 20),
                      children: [
                        for (final message in _messages)
                          _MessageBubble(
                            message: message,
                            onDecide: _decide,
                          ),
                        if (_busy &&
                            (_streaming.isNotEmpty ||
                                _streamingActions.isNotEmpty))
                          _MessageBubble(
                            message: _ChatMessage(
                              role: 'assistant',
                              content: _streaming,
                              actions: _streamingActions,
                            ),
                            onDecide: _decide,
                          )
                        else if (_busy)
                          _TypingRow(pulse: _pulse),
                      ],
                    ),
            ),
            Padding(
              padding: EdgeInsets.fromLTRB(14, 0, 14, 10 + bottomInset * 0.15),
              child: Column(
                children: [
                  Container(
                    padding: const EdgeInsets.fromLTRB(18, 6, 8, 6),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceContainerLowest,
                      borderRadius: BorderRadius.circular(28),
                      border: Border.all(
                        color: AppColors.outlineVariant.withValues(alpha: 0.85),
                      ),
                      boxShadow: const [
                        BoxShadow(
                          color: Color(0x0A0F172A),
                          blurRadius: 20,
                          offset: Offset(0, 8),
                        ),
                      ],
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _input,
                            focusNode: _focus,
                            minLines: 1,
                            maxLines: 5,
                            textInputAction: TextInputAction.newline,
                            style: AppTypography.body(fontSize: 15),
                            decoration: InputDecoration(
                              hintText: 'Message Ask AI…',
                              hintStyle: AppTypography.body(
                                fontSize: 15,
                                color: AppColors.onSurfaceVariant
                                    .withValues(alpha: 0.7),
                              ),
                              border: InputBorder.none,
                              isDense: true,
                              contentPadding:
                                  const EdgeInsets.symmetric(vertical: 10),
                            ),
                          ),
                        ),
                        const SizedBox(width: 6),
                        Padding(
                          padding: const EdgeInsets.only(bottom: 2),
                          child: Material(
                            color: _busy
                                ? AppColors.errorContainer
                                : (_input.text.trim().isEmpty && !_busy
                                    ? AppColors.surfaceContainer
                                    : AppColors.primary),
                            shape: const CircleBorder(),
                            child: InkWell(
                              customBorder: const CircleBorder(),
                              onTap: _busy
                                  ? _stop
                                  : () {
                                      if (_input.text.trim().isEmpty) return;
                                      _send();
                                    },
                              child: SizedBox(
                                width: 36,
                                height: 36,
                                child: Icon(
                                  _busy
                                      ? Icons.stop_rounded
                                      : Icons.arrow_upward_rounded,
                                  color: _busy
                                      ? AppColors.error
                                      : (_input.text.trim().isEmpty
                                          ? AppColors.outline
                                          : Colors.white),
                                  size: 18,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'AI can update CRM records — confirm before applying.',
                    style: AppTypography.caption(fontSize: 11),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyChat extends StatelessWidget {
  const _EmptyChat({required this.prompts, required this.onPrompt});

  final List<(String, IconData)> prompts;
  final void Function(String prompt) onPrompt;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(24, 24, 24, 12),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    AppColors.primary.withValues(alpha: 0.9),
                    AppColors.primaryContainer,
                  ],
                ),
                boxShadow: [
                  BoxShadow(
                    color: AppColors.primary.withValues(alpha: 0.22),
                    blurRadius: 24,
                    offset: const Offset(0, 10),
                  ),
                ],
              ),
              child: const Icon(
                Icons.auto_awesome,
                color: Colors.white,
                size: 28,
              ),
            ),
            const SizedBox(height: 22),
            Text(
              'How can I help?',
              textAlign: TextAlign.center,
              style: AppTypography.heading(fontSize: 32),
            ),
            const SizedBox(height: 8),
            Text(
              'Ask about leads, follow-ups, quotations, or what needs you today.',
              textAlign: TextAlign.center,
              style: AppTypography.body(
                fontSize: 14,
                color: AppColors.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 28),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              alignment: WrapAlignment.center,
              children: [
                for (final (prompt, icon) in prompts)
                  _SuggestionChip(
                    label: prompt,
                    icon: icon,
                    onTap: () => onPrompt(prompt),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _SuggestionChip extends StatelessWidget {
  const _SuggestionChip({
    required this.label,
    required this.icon,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surfaceContainerLowest,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          width: 156,
          padding: const EdgeInsets.fromLTRB(14, 14, 14, 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: AppColors.outlineVariant.withValues(alpha: 0.8),
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, size: 18, color: AppColors.primary),
              const SizedBox(height: 10),
              Text(
                label,
                style: AppTypography.body(
                  fontSize: 13,
                  height: 1.35,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TypingRow extends StatelessWidget {
  const _TypingRow({required this.pulse});

  final Animation<double> pulse;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: FadeTransition(
        opacity: Tween<double>(begin: 0.35, end: 1).animate(pulse),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(4, 8, 4, 8),
          child: Row(
            children: [
              Container(
                width: 26,
                height: 26,
                decoration: const BoxDecoration(
                  color: AppColors.primary,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.auto_awesome,
                  size: 13,
                  color: Colors.white,
                ),
              ),
              const SizedBox(width: 10),
              Text(
                'Thinking…',
                style: AppTypography.caption(fontSize: 13),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({required this.message, required this.onDecide});

  final _ChatMessage message;
  final Future<void> Function(_PendingAction action, bool confirm) onDecide;

  @override
  Widget build(BuildContext context) {
    final mine = message.role == 'user';

    if (mine) {
      return Align(
        alignment: Alignment.centerRight,
        child: Container(
          constraints: const BoxConstraints(maxWidth: 520),
          margin: const EdgeInsets.only(bottom: 14, left: 48),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            color: AppColors.surfaceContainer,
            borderRadius: BorderRadius.circular(22),
          ),
          child: Text(
            message.content,
            style: AppTypography.body(fontSize: 15, height: 1.45),
          ),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 26,
            height: 26,
            margin: const EdgeInsets.only(top: 2),
            decoration: const BoxDecoration(
              color: AppColors.primary,
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.auto_awesome,
              size: 13,
              color: Colors.white,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (message.content.isNotEmpty)
                  Text(
                    message.content,
                    style: AppTypography.body(fontSize: 15, height: 1.55),
                  ),
                for (final action in message.actions) ...[
                  const SizedBox(height: 10),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceContainerLowest,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: AppColors.outlineVariant),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          action.summary,
                          style: AppTypography.body(
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                        const SizedBox(height: 8),
                        if (action.state == 'pending' ||
                            action.state == 'confirming' ||
                            action.state == 'cancelling')
                          Row(
                            children: [
                              FilledButton(
                                style: FilledButton.styleFrom(
                                  backgroundColor: AppColors.primary,
                                  visualDensity: VisualDensity.compact,
                                ),
                                onPressed: action.state == 'pending'
                                    ? () => onDecide(action, true)
                                    : null,
                                child: const Text('Confirm'),
                              ),
                              const SizedBox(width: 8),
                              TextButton(
                                onPressed: action.state == 'pending'
                                    ? () => onDecide(action, false)
                                    : null,
                                child: const Text('Cancel'),
                              ),
                            ],
                          )
                        else
                          Text(
                            action.state == 'confirmed'
                                ? 'Confirmed'
                                : 'Cancelled',
                            style: AppTypography.caption(),
                          ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
