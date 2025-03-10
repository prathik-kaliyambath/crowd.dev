<template>
  <app-drawer
    v-model="isVisible"
    custom-class="integration-linkedin-drawer"
    title="LinkedIn"
    size="600px"
    pre-title="Integration"
    :pre-title-img-src="logoUrl"
    pre-title-img-alt="LinkedIn logo"
    @close="isVisible = false"
  >
    <template #content>
      <div
        class="flex flex-col gap-2 items-start mb-2"
      />
      <el-form
        v-if="isVisible"
        label-position="top"
        class="form integration-linkedin-form"
        @submit.prevent
      >
        <div class="flex flex-col gap-2 items-start">
          <span class="block text-sm font-semibold mb-2">Organization profile</span>
          <span
            class="text-2xs font-light mb-2 text-gray-600"
          >
            Monitor all comments and reactions to posts or
            shares from one of your associated organization
            profiles. <br />
          </span>
          <el-select
            v-model="model"
            placeholder="Select option"
          >
            <el-option
              v-for="organization of organizations"
              :key="organization.id"
              :label="organization.vanityName"
              :value="organization.id"
            />
          </el-select>
          <div
            v-if="
              integration.status === 'pending-action'
                && model === null
            "
            class="text-yellow-600 flex items-start"
          >
            <i class="ri-alert-line mr-2" />
            <div class="text-sm pt-0.5">
              <span class="font-medium">Action required.</span>
              Select one of your associated organization
              profiles to start tracking LinkedIn activities
            </div>
          </div>
        </div>
      </el-form>
    </template>

    <template #footer>
      <div
        class="flex grow items-center"
        :class="
          hasFormChanged ? 'justify-between' : 'justify-end'
        "
      >
        <el-button
          v-if="hasFormChanged"
          class="btn btn-link btn-link--primary"
          @click="doReset"
        >
          <i class="ri-arrow-go-back-line" />
          <span>Reset changes</span>
        </el-button>
        <div class="flex gap-4">
          <el-button
            class="btn btn--md btn--bordered"
            @click="isVisible = false"
          >
            <app-i18n code="common.cancel" />
          </el-button>
          <el-button
            class="btn btn--md btn--primary"
            :class="{
              disabled: !hasFormChanged || loading,
            }"
            :loading="loading"
            @click="hasFormChanged ? connect() : undefined"
          >
            {{
              integration.settings?.organizations.length > 0
                ? 'Update'
                : 'Connect'
            }}
          </el-button>
        </div>
      </div>
    </template>
  </app-drawer>
</template>

<script setup>
import {
  defineEmits,
  defineProps,
  computed,
  ref,
  watch,
} from 'vue';
import { useStore } from 'vuex';
import { CrowdIntegrations } from '@/integrations/integrations-config';

const store = useStore();

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
  integration: {
    type: Object,
    default: () => {},
  },
});

const emit = defineEmits(['update:modelValue']);
const organizations = computed(
  () => props.integration.settings?.organizations,
);
const selectedOrg = computed(() => organizations.value.find((o) => o.inUse === true));

const model = ref(
  selectedOrg.value ? selectedOrg.value.id : null,
);
const loading = ref(false);

const logoUrl = CrowdIntegrations.getConfig('linkedin').image;

const isVisible = computed({
  get() {
    return props.modelValue;
  },
  set(value) {
    return emit('update:modelValue', value);
  },
});

const hasFormChanged = computed(() => {
  if (selectedOrg.value === undefined) {
    return model.value !== null;
  }
  return model.value !== selectedOrg.value.id;
});

const doReset = () => {
  model.value = selectedOrg.value
    ? selectedOrg.value.id
    : null;
};

const connect = async () => {
  loading.value = true;
  await store.dispatch(
    'integration/doLinkedinOnboard',
    model.value,
  );
  loading.value = false;
  isVisible.value = false;
};

watch(isVisible, (newValue, oldValue) => {
  if (newValue) {
    window.analytics.track('LinkedIn: settings drawer', {
      action: 'open',
    });
  } else if (newValue === false && oldValue) {
    window.analytics.track('LinkedIn: settings drawer', {
      action: 'close',
    });
  }
});
</script>

<script>
export default {
  name: 'AppLinkedInConnectDrawer',
};
</script>
