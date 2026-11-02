<script setup lang="ts">
import {onMounted} from 'vue';
import {initialise,state} from './client';
onMounted(()=>{void initialise();});
</script>
<template><div class="site-shell"><header class="site-header"><RouterLink to="/" class="brand" aria-label="Meridian home"><span class="brand-mark">M</span><strong>MERIDIAN</strong><small>RESEARCH</small></RouterLink><nav aria-label="Main navigation"><RouterLink to="/research">Public research</RouterLink><RouterLink to="/guide">Product guide</RouterLink><RouterLink v-if="state.user" class="header-account" to="/app/notes">Workspace <span>{{state.user.display_name}}</span></RouterLink><RouterLink v-else class="header-account" to="/login">Sign in <span>↗</span></RouterLink></nav></header><RouterView/><footer class="site-footer"><span>Meridian / Research workspace</span><RouterLink to="/guide">Data &amp; access</RouterLink><a href="https://github.com/dengbenben123-bot/meridian-research-terminal" target="_blank" rel="noopener noreferrer">GitHub ↗</a><small>Public pages · Private workspaces</small></footer></div></template>
