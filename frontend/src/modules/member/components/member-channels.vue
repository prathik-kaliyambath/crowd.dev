<template>
  <div
    v-if="hasSocialIdentities"
    class="flex items-center gap-3"
  >
    <div class="flex gap-2 items-center">
      <app-platform
        v-if="!!member.username?.twitter"
        platform="twitter"
        track-event-name="Click Member Contact"
        track-event-channel="Twitter"
        :has-tooltip="true"
        tooltip-label="Twitter profile"
        :href="member.attributes?.url?.twitter || null"
        :as-link="true"
      />
      <app-platform
        v-if="!!member.username?.github"
        platform="github"
        track-event-name="Click Member Contact"
        track-event-channel="GitHub"
        :has-tooltip="true"
        tooltip-label="GitHub profile"
        :href="member.attributes?.url?.github || null"
        :as-link="true"
      />
      <app-platform
        v-if="!!member.username?.devto"
        platform="devto"
        track-event-name="Click Member Contact"
        track-event-channel="Dev.to"
        :has-tooltip="true"
        tooltip-label="DEV profile"
        :href="member.attributes?.url?.devto || null"
        :as-link="true"
      />
      <app-platform
        v-if="!!member.username?.discord"
        platform="discord"
        track-event-name="Click Member Contact"
        track-event-channel="Discord"
        :has-tooltip="true"
        tooltip-label="Discord profile"
      />
      <app-platform
        v-if="!!member.username?.slack"
        platform="slack"
        track-event-name="Click Member Contact"
        track-event-channel="Slack"
        :has-tooltip="true"
        tooltip-label="Slack profile"
      />
      <app-platform
        v-if="!!member.username?.hackernews"
        platform="hackernews"
        track-event-name="Click Member Contact"
        track-event-channel="Hackernews"
        :has-tooltip="true"
        tooltip-label="Hacker News profile"
        :href="`https://news.ycombinator.com/user?id=${member.username.hackernews}`"
        :as-link="true"
      />
      <app-platform
        v-if="!!member.username?.reddit"
        platform="reddit"
        track-event-name="Click Member Contact"
        track-event-channel="Reddit"
        :has-tooltip="true"
        tooltip-label="Reddit profile"
        :href="`https://reddit.com/u/${member.username.reddit}`"
        :as-link="true"
      />
      <app-platform
        v-if="!!member.username?.linkedin"
        platform="linkedin"
        track-event-name="Click Member Contact"
        track-event-channel="LinkedIn"
        :has-tooltip="true"
        tooltip-label="LinkedIn profile"
        :href="`https://linkedin.com/in/${member.username.linkedin}`"
        :as-link="true"
      />
      <app-platform
        v-if="!!member.username?.stackoverflow"
        platform="stackoverflow"
        track-event-name="Click Member Contact"
        track-event-channel="Stack Overflow"
        :has-tooltip="true"
        tooltip-label="Stack Overflow profile"
        :href="`${member.attributes?.url?.stackoverflow}`"
        :as-link="true"
      />
    </div>
  </div>
  <div v-else>
    -
  </div>
</template>

<script setup>
import { defineProps, computed } from 'vue';

const props = defineProps({
  member: {
    type: Object,
    default: () => {},
  },
});

const hasSocialIdentities = computed(
  () => !!props.member.username?.twitter
    || !!props.member.username?.github
    || !!props.member.username?.devto
    || !!props.member.username?.discord
    || !!props.member.username?.slack
    || !!props.member.username?.hackernews
    || !!props.member.username?.reddit
    || !!props.member.username?.linkedin
    || !!props.member.username?.stackoverflow,
);
</script>

<script>
export default {
  name: 'AppMemberChannels',
};
</script>
