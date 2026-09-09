import { apiFetch } from './client';

export interface ExportHeartbeatResponse {
	sessionId: string;
	expiresAt: string;
}

export function heartbeatExport(input: { sessionId?: string }): Promise<ExportHeartbeatResponse> {
	return apiFetch('/v1/lifecycle/export/heartbeat', { method: 'POST', body: input });
}

export function completeExport(input: { sessionId: string }): Promise<void> {
	return apiFetch('/v1/lifecycle/export/complete', { method: 'POST', body: input });
}

export function markExpiryScreenShown(): Promise<void> {
	return apiFetch('/v1/lifecycle/expiry-shown', { method: 'POST' });
}

export interface NotificationEmailStatus {
	email?: string | null;
	verified: boolean;
	verifiedAt?: string | null;
}

export function getNotificationEmail(): Promise<NotificationEmailStatus> {
	return apiFetch('/v1/me/notification-email');
}

export function setNotificationEmail(input: { email: string }): Promise<void> {
	return apiFetch('/v1/me/notification-email', { method: 'PUT', body: input });
}

export function verifyNotificationEmail(input: { token: string }): Promise<void> {
	return apiFetch('/v1/me/notification-email/verify', { method: 'POST', body: input });
}

export function resendNotificationEmail(): Promise<void> {
	return apiFetch('/v1/me/notification-email/resend', { method: 'POST' });
}
