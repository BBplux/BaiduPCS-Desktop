<script setup lang="ts">
import files from "../assets/official/empty-files.png";
import upload from "../assets/official/empty-upload.jpg";
import download from "../assets/official/empty-download.jpg";
withDefaults(defineProps<{ kind?: "files" | "upload" | "download" }>(), {
  kind: "files",
});
const sources = { files, upload, download };
</script>
<template>
  <img
    class="empty-illustration"
    :src="sources[kind]"
    alt=""
    aria-hidden="true"
    draggable="false"
  />
</template>
