/* sources.defaults.js
 * Canonical Source Registry Defaults (Dev-provided contract)
 *
 * Goal:
 * - Centralize all known Janitor script context paths.
 * - Enforce READ vs WRITE boundaries.
 * - Allow modules to declare which sources they read.
 * - Allow Engine to reason about write-target conflicts deterministically.
 *
 * Notes:
 * - This tool is standalone; these are “known paths” for scripts that will run on JAI.
 * - READ means scripts can inspect the value.
 * - WRITE means scripts are permitted to mutate that value.
 * - advancedOnly means: do not expose in Basic UI; Advanced may reference it.
 */

(function (root) {
  'use strict';

  if (!root.Sources || !root.Sources.defineDefaults) {
    throw new Error('sources.defaults.js requires sources.js loaded first (root.Sources.defineDefaults missing).');
  }

  // Helper for consistency
  function def(id, path, meta) {
    return {
      id: id,
      path: path,
      // meta: { label, group, read, write, advancedOnly, notes }
      meta: meta || {}
    };
  }

  root.Sources.defineDefaults([
    /* =========================
     * CHARACTER (READ)
     * ========================= */
    def('character.name', 'context.character.name', {
      label: 'Character Name',
      group: 'character',
      read: true,
      write: false
    }),

    def('character.chatName', 'context.character.chat_name', {
      label: 'Chat Name',
      group: 'character',
      read: true,
      write: false
    }),

    def('character.exampleDialogs', 'context.character.example_dialogs', {
      label: 'Example Dialogs',
      group: 'character',
      read: true,
      write: true, // WRITE allowed
      notes: 'Writable per dev contract.'
    }),

    def('character.personality', 'context.character.personality', {
      label: 'Personality',
      group: 'character',
      read: true,
      write: true // WRITE allowed
    }),

    def('character.scenario', 'context.character.scenario', {
      label: 'Scenario',
      group: 'character',
      read: true,
      write: true // WRITE allowed
    }),

    // Acknowledged but Advanced-only until understood
    def('character.customPromptComplete', 'context.character.custom_prompt_complete', {
      label: 'Custom Prompt Complete',
      group: 'character',
      read: true,
      write: false,
      advancedOnly: true,
      notes: 'Dev-provided field; behavior/meaning not yet clarified.'
    }),

    /* =========================
     * CHAT (READ)
     * ========================= */
    def('chat.lastMessage', 'context.chat.last_message', {
      label: 'Last Message',
      group: 'chat',
      read: true,
      write: false
    }),

    def('chat.lastMessages', 'context.chat.last_messages', {
      label: 'Last Messages (Array)',
      group: 'chat',
      read: true,
      write: false,
      notes: 'Array<{ is_bot:boolean, date:Date|undefined, message:string }>'
    }),

    def('chat.firstMessageDate', 'context.chat.first_message_date', {
      label: 'First Message Date',
      group: 'chat',
      read: true,
      write: false,
      advancedOnly: true,
      notes: 'Optional. Advanced-only until Basic needs it.'
    }),

    def('chat.lastBotMessageDate', 'context.chat.last_bot_message_date', {
      label: 'Last Bot Message Date',
      group: 'chat',
      read: true,
      write: false,
      advancedOnly: true,
      notes: 'Optional. Advanced-only until Basic needs it.'
    }),

    def('chat.messageCount', 'context.chat.message_count', {
      label: 'Message Count',
      group: 'chat',
      read: true,
      write: false
    }),

    def('chat.contextLength', 'context.chat.contextLength', {
      label: 'Context Length',
      group: 'chat',
      read: true,
      write: false,
      advancedOnly: true,
      notes: 'Optional. Naming is dev-provided.'
    }),

    def('chat.userName', 'context.chat.user_name', {
      label: 'User Name',
      group: 'chat',
      read: true,
      write: false,
      notes: 'nullable'
    }),

    def('chat.personaName', 'context.chat.persona_name', {
      label: 'Persona Name',
      group: 'chat',
      read: true,
      write: false,
      notes: 'nullable'
    })
  ]);

})(window);
