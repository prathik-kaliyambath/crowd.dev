<template>
  <section>
    <h6 class="text-base leading-6 font-semibold pb-3">
      Integrations
    </h6>
    <div v-if="loadingFetch">
      <div
        v-for="index in 4"
        :key="index"
        class="py-3.5 border-gray-100"
        :class="{ 'border-t': index > 1 }"
      >
        <app-loading
          width="110px"
          height="16px"
          radius="4px"
        />
      </div>
    </div>
    <div v-else>
      <div
        v-if="activeIntegrations.length > 0"
        class="pb-1"
      >
        <article
          v-for="integration in activeIntegrations"
          :key="integration.platform"
          class="border-t border-gray-100 py-3 flex items-center justify-between first:border-none"
        >
          <div class="flex items-center">
            <div class="mr-4">
              <img
                class="w-5 h-5"
                :src="
                  platformDetails(integration.platform)
                    .image
                "
                :alt="
                  platformDetails(integration.platform).name
                "
              />
            </div>
            <p class="text-xs leading-4">
              {{
                platformDetails(integration.platform).name
              }}
            </p>
          </div>
          <div>
            <div v-if="integration.status === 'done'">
              <el-tooltip
                effect="dark"
                content="Connected"
                placement="top-start"
              >
                <div
                  class="p-1 ri-checkbox-blank-circle-fill text-4xs text-green-400"
                />
              </el-tooltip>
            </div>
            <div v-else-if="integration.status === 'error'">
              <el-tooltip
                effect="dark"
                content="Failed to connect"
                placement="top-start"
              >
                <div
                  class="ri-error-warning-line text-base text-red-500"
                />
              </el-tooltip>
            </div>
            <div
              v-else-if="integration.status === 'no-data'"
            >
              <el-tooltip
                effect="dark"
                content="Not getting activities"
                placement="top-start"
              >
                <div
                  class="ri-error-warning-line text-base text-red-500"
                />
              </el-tooltip>
            </div>
            <div
              v-else-if="
                integration.status === 'pending-action'
              "
            >
              <el-tooltip
                effect="dark"
                content="Action required"
                placement="top-start"
              >
                <div
                  class="ri-alert-fill text-base text-yellow-500"
                />
              </el-tooltip>
            </div>
            <div
              v-else-if="
                integration.status === 'waiting-approval'
              "
            >
              <el-tooltip
                effect="dark"
                content="Waiting for approval"
                placement="top-start"
              >
                <div
                  class="ri-time-line text-base text-gray-500"
                />
              </el-tooltip>
            </div>
            <div
              v-else-if="integration.status !== undefined"
            >
              <el-tooltip
                effect="dark"
                content="In progress"
                placement="top-start"
              >
                <div
                  v-loading="true"
                  class="app-page-spinner !relative h-4 !w-4 mr-2 !min-h-fit"
                />
              </el-tooltip>
            </div>
          </div>
        </article>
      </div>
      <div v-else class="flex flex-col items-center pt-3">
        <div
          class="ri-apps-2-line text-3xl text-gray-300"
        />
        <p
          class="text-xs italic leading-4 text-gray-400 text-center pt-4"
        >
          No connected integrations yet
        </p>
      </div>
    </div>

    <div v-if="!loadingFetch" class="pt-3">
      <router-link :to="{ name: 'integration' }" route>
        <el-button
          class="btn btn-brand--transparent btn--sm w-full leading-5"
        >
          <span
            v-if="activeIntegrations.length > 0"
            class="text-brand-500"
          >Manage integrations</span>
          <span v-else>Connect integration</span>
        </el-button>
      </router-link>
    </div>
  </section>
</template>

<script>
import { mapActions, mapGetters } from 'vuex';
import { CrowdIntegrations } from '@/integrations/integrations-config';
import AppLoading from '@/shared/loading/loading-placeholder.vue';

export default {
  name: 'AppDashboardIntegrations',
  components: { AppLoading },
  data() {
    return {
      storeUnsubscribe: () => {},
    };
  },
  computed: {
    ...mapGetters('integration', ['array', 'loadingFetch']),
    activeIntegrations() {
      return CrowdIntegrations.mappedEnabledConfigs(
        this.$store,
      ).filter((integration) => integration.status);
    },
  },
  async mounted() {
    window.analytics.page('Dashboard');
    await this.fetchIntegrations();
    this.storeUnsubscribe = await this.$store.subscribeAction(async (action) => {
      if (action.type === 'auth/doRefreshCurrentUser') {
        await this.fetchIntegrations();
      }
    });
  },
  beforeUnmount() {
    this.storeUnsubscribe();
  },
  methods: {
    ...mapActions('integration', {
      fetchIntegrations: 'doFetch',
    }),
    platformDetails(platform) {
      return CrowdIntegrations.getMappedConfig(
        platform,
        this.$store,
      );
    },
  },
};
</script>
