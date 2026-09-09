import { apiFetch } from './client';

export interface RealtimeTicketResponse {
	ticket: string;
	expiresAt: string;
}

export function mintRealtimeTicket(accountId: string): Promise<RealtimeTicketResponse> {
	return apiFetch<RealtimeTicketResponse>('/v1/realtime/ticket', {
		method: 'POST',
		accountId
	});
}
