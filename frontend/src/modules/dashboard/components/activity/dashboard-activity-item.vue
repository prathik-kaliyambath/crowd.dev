<template>
  <article
    v-if="loading || !activity"
    class="py-5 border-gray-200 relative"
  >
    <div class="flex">
      <div class="pr-3">
        <app-loading
          height="32px"
          width="32px"
          radius="50%"
        />
      </div>
      <div class="flex-grow w-full pt-2.5">
        <app-loading
          height="12px"
          width="320px"
          class="mb-3"
        />
        <app-loading height="12px" width="280px" />
      </div>
    </div>
  </article>
  <article v-else class="py-5 border-gray-200 relative">
    <div class="flex">
      <!-- avatar -->
      <div class="pr-3">
        <router-link
          :to="{
            name: 'memberView',
            params: { id: activity.member.id },
          }"
          target="_blank"
        >
          <app-avatar :entity="activity.member" size="xs" />
        </router-link>
      </div>
      <div class="flex-grow w-full">
        <!-- Name -->
        <div class="flex justify-between w-full">
          <div>
            <app-member-display-name
              class="flex items-center pb-0.5"
              custom-class="text-2xs leading-4 block text-gray-600"
              :member="activity.member"
              with-link
            />
            <div class="flex items-center">
              <div>
                <el-tooltip
                  effect="dark"
                  :content="platform.name"
                  placement="top"
                >
                  <img
                    :alt="platform.name"
                    class="w-4 h-4"
                    :src="platform.image"
                  />
                </el-tooltip>
              </div>
              <p class="flex text-2xs leading-4 pl-2">
                <app-activity-message
                  :activity="activity"
                />
                <span
                  class="whitespace-nowrap text-gray-500"
                ><span class="mx-1">·</span>{{ timeAgo }}</span>
                <span class="mx-1">·</span>
                <app-activity-sentiment
                  :sentiment="activity.sentiment.sentiment"
                />
              </p>
            </div>
          </div>
          <div>
            <app-activity-dropdown :activity="activity" />
          </div>
        </div>
        <!-- Content -->
        <div class="pt-4">
          <app-activity-content
            :activity="activity"
            :display-body="false"
            :display-title="false"
          />
          <app-activity-content
            class="text-xs bg-gray-50 rounded-lg p-4"
            :activity="activity"
            :show-more="true"
            :display-thread="false"
          >
            <div v-if="activity.url" class="pt-6">
              <a
                :href="activity.url"
                class="text-2xs text-gray-600 font-medium flex items-center"
                target="_blank"
                rel="noopener noreferrer"
              ><i
                 class="ri-lg ri-external-link-line mr-1"
               />
                <span class="block">Open on {{ platform.name }}</span></a>
            </div>
          </app-activity-content>
        </div>
      </div>
    </div>
  </article>
</template>

<script>
import { formatDateToTimeAgo } from '@/utils/date';
import { CrowdIntegrations } from '@/integrations/integrations-config';
import AppAvatar from '@/shared/avatar/avatar.vue';
import AppActivityDropdown from '@/modules/activity/components/activity-dropdown.vue';
import AppLoading from '@/shared/loading/loading-placeholder.vue';
import AppActivityContent from '@/modules/activity/components/activity-content.vue';
import AppActivityMessage from '@/modules/activity/components/activity-message.vue';
import AppMemberDisplayName from '@/modules/member/components/member-display-name.vue';
import AppActivitySentiment from '@/modules/activity/components/activity-sentiment.vue';

export default {
  name: 'AppDashboardActivityItem',
  components: {
    AppActivitySentiment,
    AppMemberDisplayName,
    AppActivityMessage,
    AppActivityContent,
    AppLoading,
    AppActivityDropdown,
    AppAvatar,
  },
  props: {
    activity: {
      type: Object,
      required: false,
      default: () => ({}),
    },
    loading: {
      type: Boolean,
      required: false,
      default: false,
    },
  },
  computed: {
    platform() {
      return CrowdIntegrations.getConfig(
        this.activity.platform,
      );
    },
    timeAgo() {
      return formatDateToTimeAgo(this.activity.timestamp);
    },
  },
};
</script>
