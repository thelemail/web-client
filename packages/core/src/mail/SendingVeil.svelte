<script lang="ts">
	import { m } from '$paraglide/messages.js';
</script>

<div class="send-veil" aria-live="polite" aria-busy="true">
	<div class="sv-ring"></div>
	<div class="sv-t">{m.mail_sending_title()}</div>
	<div class="sv-d">{m.mail_sending_detail()}</div>
</div>
