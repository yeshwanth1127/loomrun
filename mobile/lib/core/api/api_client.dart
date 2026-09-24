import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/api_config.dart';
import 'api_exception.dart';
import 'token_store.dart';

/// Thin HTTP client matching the web app's `apiFetch` behaviour:
/// Bearer auth, single-flight refresh on 401, then retry once.
class ApiClient {
  ApiClient({
    TokenStore? tokens,
    http.Client? httpClient,
    String? baseUrl,
  })  : _tokens = tokens ?? tokenStore,
        _http = httpClient ?? http.Client(),
        _baseUrl = baseUrl;

  final TokenStore _tokens;
  final http.Client _http;
  final String? _baseUrl;

  String get baseUrl => _baseUrl ?? apiBaseUrl;

  static const _noRefreshPrefixes = [
    '/v1/auth/login',
    '/v1/auth/register',
    '/v1/auth/refresh',
  ];

  Future<void> Function()? onSessionExpired;

  Future<T> get<T>(
    String path, {
    Map<String, String>? query,
  }) {
    return request<T>('GET', path, query: query);
  }

  Future<T> post<T>(
    String path, {
    Object? json,
    Map<String, String>? query,
  }) {
    return request<T>('POST', path, json: json, query: query);
  }

  Future<T> patch<T>(
    String path, {
    Object? json,
    Map<String, String>? query,
  }) {
    return request<T>('PATCH', path, json: json, query: query);
  }

  Future<T> delete<T>(
    String path, {
    Object? json,
    Map<String, String>? query,
  }) {
    return request<T>('DELETE', path, json: json, query: query);
  }

  Future<T> request<T>(
    String method,
    String path, {
    Object? json,
    Map<String, String>? query,
  }) async {
    final uri = _buildUri(path, query);
    final body = json != null ? jsonEncode(json) : null;

    var response = await _send(method, uri, body);
    final canRefresh = !_noRefreshPrefixes.any(path.startsWith) &&
        await _tokens.getRefreshToken() != null;

    if (response.statusCode == 401 && canRefresh) {
      final refreshed = await refreshAccessToken();
      if (refreshed) {
        response = await _send(method, uri, body);
      }
    }

    if (response.statusCode == 204) {
      return null as T;
    }

    final text = response.body;
    Object? data;
    if (text.isNotEmpty) {
      try {
        data = jsonDecode(text);
      } catch (_) {
        final preview = text.replaceAll(RegExp(r'\s+'), ' ').trim();
        final short =
            preview.length > 80 ? '${preview.substring(0, 80)}…' : preview;
        if (response.statusCode >= 500) {
          throw const ApiException(
            'Server unavailable. Try again in a moment.',
          );
        }
        throw ApiException(
          'Unexpected response from server (${response.statusCode}): $short',
          statusCode: response.statusCode,
        );
      }
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      if (response.statusCode == 401) {
        await _tokens.clearTokens();
        final handler = onSessionExpired;
        if (handler != null) await handler();
      }
      throw ApiException(
        _errorDetail(data, response.reasonPhrase ?? 'Request failed'),
        statusCode: response.statusCode,
      );
    }

    return data as T;
  }

  Future<bool> refreshAccessToken() async {
    if (_refreshInFlight != null) return _refreshInFlight!;
    _refreshInFlight = _doRefresh();
    try {
      return await _refreshInFlight!;
    } finally {
      _refreshInFlight = null;
    }
  }

  Future<bool>? _refreshInFlight;

  Future<bool> _doRefresh() async {
    final refresh = await _tokens.getRefreshToken();
    if (refresh == null) return false;
    try {
      final uri = Uri.parse('$baseUrl/v1/auth/refresh');
      final res = await _http.post(
        uri,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({'refresh_token': refresh}),
      );
      if (res.statusCode < 200 || res.statusCode >= 300) {
        await _tokens.clearTokens();
        return false;
      }
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      await _tokens.setTokens(
        access: data['access_token'] as String,
        refresh: data['refresh_token'] as String,
      );
      return true;
    } catch (_) {
      return false;
    }
  }

  Uri _buildUri(String path, Map<String, String>? query) {
    final base = Uri.parse('$baseUrl$path');
    if (query == null || query.isEmpty) return base;
    return base.replace(queryParameters: {
      ...base.queryParameters,
      ...query,
    });
  }

  /// POST a JSON body and read a server-sent event stream (`data: {...}` frames).
  ///
  /// [streamClient] is owned by the caller so closing it aborts the turn
  /// without tearing down the shared client used for ordinary requests.
  Future<void> postEventStream(
    String path, {
    required Object json,
    required void Function(Map<String, dynamic> event) onEvent,
    required http.Client streamClient,
  }) async {
    Future<http.StreamedResponse> send() async {
      final request = http.Request('POST', _buildUri(path, null));
      request.headers['Accept'] = 'text/event-stream';
      request.headers['Content-Type'] = 'application/json';
      final token = await _tokens.getAccessToken();
      if (token != null && token.isNotEmpty) {
        request.headers['Authorization'] = 'Bearer $token';
      }
      request.body = jsonEncode(json);
      return streamClient.send(request);
    }

    var response = await send();
    if (response.statusCode == 401 && await _tokens.getRefreshToken() != null) {
      final refreshed = await refreshAccessToken();
      if (refreshed) response = await send();
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final text = await response.stream.bytesToString();
      Object? data;
      if (text.isNotEmpty) {
        try {
          data = jsonDecode(text);
        } catch (_) {
          data = null;
        }
      }
      throw ApiException(
        _errorDetail(data, response.reasonPhrase ?? 'Request failed'),
        statusCode: response.statusCode,
      );
    }

    final buffer = StringBuffer();
    await for (final chunk in response.stream.transform(utf8.decoder)) {
      buffer.write(chunk);
      var pending = buffer.toString();
      buffer.clear();
      while (true) {
        final split = pending.indexOf('\n\n');
        if (split < 0) {
          buffer.write(pending);
          break;
        }
        final frame = pending.substring(0, split);
        pending = pending.substring(split + 2);
        final dataLines = <String>[];
        for (final line in frame.split('\n')) {
          if (line.startsWith('data:')) {
            dataLines.add(line.substring(5).trimLeft());
          }
        }
        if (dataLines.isEmpty) continue;
        final raw = dataLines.join('\n');
        try {
          final decoded = jsonDecode(raw);
          if (decoded is Map) {
            onEvent(Map<String, dynamic>.from(decoded));
          }
        } catch (_) {
          // Ignore a partial or non-JSON frame and keep reading.
        }
      }
    }
  }

  Future<http.Response> _send(String method, Uri uri, String? body) async {
    final headers = <String, String>{'Accept': 'application/json'};
    final token = await _tokens.getAccessToken();
    if (token != null && token.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }
    if (body != null) {
      headers['Content-Type'] = 'application/json';
    }

    try {
      switch (method.toUpperCase()) {
        case 'GET':
          return await _http
              .get(uri, headers: headers)
              .timeout(const Duration(seconds: 20));
        case 'POST':
          return await _http
              .post(uri, headers: headers, body: body)
              .timeout(const Duration(seconds: 20));
        case 'PATCH':
          return await _http
              .patch(uri, headers: headers, body: body)
              .timeout(const Duration(seconds: 20));
        case 'PUT':
          return await _http
              .put(uri, headers: headers, body: body)
              .timeout(const Duration(seconds: 20));
        case 'DELETE':
          return await _http
              .delete(uri, headers: headers, body: body)
              .timeout(const Duration(seconds: 20));
        default:
          throw ApiException('Unsupported HTTP method: $method');
      }
    } on TimeoutException {
      throw const ApiException('Request timed out. Try again.');
    } on http.ClientException catch (e) {
      throw ApiException(
        'Cannot reach server at $baseUrl. Is the API running?\n${e.message}',
      );
    }
  }

  static String _errorDetail(Object? data, String fallback) {
    if (data is Map) {
      final detail = data['detail'];
      if (detail is String) return detail;
      if (detail is Map) {
        final message = detail['message'] ?? detail['detail'];
        if (message is String) return message;
        try {
          return jsonEncode(detail);
        } catch (_) {
          return fallback;
        }
      }
      if (detail is List && detail.isNotEmpty) {
        final first = detail.first;
        if (first is Map && first['msg'] is String) {
          return first['msg'] as String;
        }
        return detail.toString();
      }
    }
    return fallback;
  }
}

final apiClient = ApiClient();
