<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import { trackAccountDeletionCompleted } from '../modules/analytics'

// The server deletes the user and revokes the session before redirecting here. Failures remain JSON responses at the callback.
// Source: better-auth/dist/api/routes/update-user.mjs.
// Ask users to close this tab because the API origin cannot identify the calling product UI.
const { t } = useI18n()
const route = useRoute()

// Optional ?error param if a future server hook redirects failed deletions
// here with an explanatory string. Today this is always undefined.
const errorMessage = computed(() => {
  const value = route.query.error
  return typeof value === 'string' ? value : null
})

onMounted(() => {
  // Strongest churn fact the client can observe: better-auth only
  // redirects here after the deletion callback already ran server-side,
  // so rendering the success state means the account is gone.
  if (!errorMessage.value)
    trackAccountDeletionCompleted()
})
</script>

<template>
  <main
    :class="[
      'min-h-screen flex flex-col items-center justify-center px-6 py-10 font-cuteen',
    ]"
  >
    <div :class="['mb-6 text-2xl font-bold']">
      {{
        errorMessage
          ? t('server.auth.deleteAccount.title.failed')
          : t('server.auth.deleteAccount.title.success')
      }}
    </div>

    <div :class="['max-w-sm flex flex-col items-center gap-4 text-center text-sm']">
      <p
        v-if="!errorMessage"
        :class="['text-neutral-600 dark:text-neutral-300']"
      >
        {{ t('server.auth.deleteAccount.message.success') }}
      </p>
      <p
        v-else
        :class="['text-red-500']"
      >
        {{ errorMessage }}
      </p>

      <p
        v-if="!errorMessage"
        :class="['text-xs text-neutral-400 dark:text-neutral-500']"
      >
        {{ t('server.auth.deleteAccount.action.closeTab') }}
      </p>
    </div>
  </main>
</template>

<route lang="yaml">
meta:
  layout: plain
</route>
