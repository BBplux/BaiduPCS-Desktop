<script setup lang="ts">
import warning from "../assets/official/controls/delete-warning.svg";
defineProps<{ open: boolean; busy: boolean }>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();
</script>
<template>
  <a-config-provider :auto-insert-space-in-button="false">
    <a-modal
      :open="open"
      class="file-delete-modal"
      :width="360"
      centered
      :footer="null"
      :mask-closable="false"
      :keyboard="!busy"
      :closable="!busy"
      @cancel="!busy && emit('cancel')"
    >
      <template #title>
        <div class="file-delete-title">
          <img :src="warning" alt="" />
          <span>确定删除文件？</span>
        </div>
      </template>
      <template #closeIcon
        ><span class="official-font">&#xe60a;</span></template
      >
      <p class="file-delete-message">删除后，可在回收站中找回删除的文件。</p>
      <div class="file-delete-actions">
        <a-button
          class="file-delete-cancel"
          :disabled="busy"
          @click="emit('cancel')"
          >取消</a-button
        >
        <a-button
          class="file-delete-confirm"
          type="primary"
          :loading="busy"
          @click="emit('confirm')"
          >删除</a-button
        >
      </div>
    </a-modal>
  </a-config-provider>
</template>
