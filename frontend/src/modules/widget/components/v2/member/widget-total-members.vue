<template>
  <div class="widget-total-members">
    <div class="flex justify-between items-center mb-4">
      <app-widget-title
        text-size="text-base"
        description="All members who did at least one activity in your community and its evolution over time"
        title="Total members"
        class="mb-5"
      />
      <app-widget-period
        :period="period"
        module="report"
        @on-update="
          (updatedPeriod) => (period = updatedPeriod)
        "
      />
    </div>
    <div>
      <query-renderer
        v-if="cubejsApi"
        :cubejs-api="cubejsApi"
        :query="query"
      >
        <template #default="{ resultSet, loading, error }">
          <!-- Loading -->
          <app-widget-loading
            v-if="loading || !resultSet?.loadResponses"
            size="small"
          />

          <!-- Error -->
          <app-widget-error v-else-if="error" />

          <!-- Widgets -->
          <div v-else class="grid grid-cols-12 gap-2">
            <div class="col-span-5">
              <app-widget-kpi
                :current-value="kpiCurrentValue(resultSet)"
                :previous-value="
                  kpiPreviousValue(resultSet)
                "
                :vs-label="`vs. last ${period.extendedLabel}`"
                class="col-span-5"
              />
            </div>
            <div class="col-span-7 chart">
              <app-widget-area
                :result-set="chartResultSet(resultSet)"
                :datasets="datasets"
                :chart-options="widgetChartOptions"
                :granularity="granularity"
                :is-grid-min-max="true"
                @on-view-more-click="onViewMoreClick"
              />
            </div>
          </div>
        </template>
      </query-renderer>
    </div>
  </div>
  <app-widget-drawer
    v-if="drawerExpanded"
    v-model="drawerExpanded"
    :fetch-fn="getTotalMembers"
    :date="drawerDate"
    :granularity="granularity"
    :show-date="true"
    :title="drawerTitle"
    :template="MEMBERS_REPORT.nameAsId"
    size="480px"
    @on-export="onExport"
  />
</template>
<script setup>
import moment from 'moment';
import cloneDeep from 'lodash/cloneDeep';
import { ref, computed, defineProps } from 'vue';
import { QueryRenderer } from '@cubejs-client/vue3';
import { SEVEN_DAYS_PERIOD_FILTER } from '@/modules/widget/widget-constants';
import { chartOptions } from '@/modules/report/templates/template-report-charts';

import AppWidgetKpi from '@/modules/widget/components/v2/shared/widget-kpi.vue';
import AppWidgetTitle from '@/modules/widget/components/v2/shared/widget-title.vue';
import AppWidgetPeriod from '@/modules/widget/components/v2/shared/widget-period.vue';
import AppWidgetArea from '@/modules/widget/components/v2/shared/widget-area.vue';
import AppWidgetLoading from '@/modules/widget/components/v2/shared/widget-loading.vue';
import AppWidgetError from '@/modules/widget/components/v2/shared/widget-error.vue';

import {
  mapGetters,
  mapActions,
} from '@/shared/vuex/vuex.helpers';
import { getTimeGranularityFromPeriod, parseAxisLabel } from '@/utils/reports';
import {
  TOTAL_MEMBERS_QUERY,
  TOTAL_MEMBERS_FILTER,
} from '@/modules/widget/widget-queries';
import { MemberService } from '@/modules/member/member-service';
import AppWidgetDrawer from '@/modules/widget/components/v2/shared/widget-drawer.vue';
import { MEMBERS_REPORT } from '@/modules/report/templates/template-reports';

const props = defineProps({
  filters: {
    type: Object,
    default: null,
  },
  isPublicView: {
    type: Boolean,
    default: false,
  },
});

const period = ref(SEVEN_DAYS_PERIOD_FILTER);
const drawerExpanded = ref();
const drawerDate = ref();
const drawerTitle = ref();

const widgetChartOptions = chartOptions('area', {
  legendPlugin: false,
});

const granularity = computed(() => getTimeGranularityFromPeriod(period.value));
const datasets = computed(() => [
  {
    name: 'Total members',
    borderColor: '#E94F2E',
    measure: 'Members.cumulativeCount',
    granularity: granularity.value,
    ...(!props.isPublicView && {
      tooltipBtn: 'View members',
    }),
  },
]);

const { doExport } = mapActions('member');
const { cubejsApi } = mapGetters('widget');

const query = computed(() => TOTAL_MEMBERS_QUERY({
  period: period.value,
  granularity,
  selectedPlatforms: props.filters.platform.value,
  selectedHasTeamMembers: props.filters.teamMembers,
}));

const kpiCurrentValue = (resultSet) => {
  const data = resultSet.chartPivot();
  return Number(
    data[data.length - 1]['Members.cumulativeCount'],
  ) || 0;
};

const kpiPreviousValue = (resultSet) => {
  const data = resultSet.chartPivot();
  return Number(data[0]['Members.cumulativeCount']) || 0;
};

const spliceFirstValue = (data) => cloneDeep(data).reduce((acc, item, index) => {
  if (index !== 0) {
    acc.push({
      ...item,
    });
  }
  return acc;
}, []);

const chartResultSet = (resultSet) => {
  const clone = cloneDeep(resultSet);

  // We'll be excluding the first data point, since it's related to the last period
  clone.loadResponses[0].data = spliceFirstValue(
    clone.loadResponses[0].data,
  );

  // Then we also fix the first entry of the dateRange
  clone.loadResponses[0].query.timeDimensions[0].dateRange[0] = moment(
    clone.loadResponses[0].query.timeDimensions[0]
      .dateRange[0],
  )
    .utc()
    .add(1, 'day')
    .format('YYYY-MM-DD');

  return clone;
};

// Fetch function to pass to detail drawer
const getTotalMembers = async ({ pagination }) => {
  const res = await MemberService.list(
    TOTAL_MEMBERS_FILTER({
      date: drawerDate.value,
      granularity: granularity.value,
      selectedPlatforms: props.filters.platform.value,
      selectedHasTeamMembers: props.filters.teamMembers,
    }),
    'joinedAt_DESC',
    pagination.pageSize,
    (pagination.currentPage - 1) * pagination.pageSize,
    false,
  );
  return res;
};

// Open drawer and set drawer title,
// and detailed date
const onViewMoreClick = (date) => {
  window.analytics.track('Open report drawer', {
    template: MEMBERS_REPORT.nameAsId,
    widget: 'Total members',
    date,
    granularity: granularity.value,
  });

  drawerExpanded.value = true;
  drawerDate.value = date;

  // Title
  if (granularity.value === 'week') {
    drawerTitle.value = 'Weekly total members';
  } else if (granularity.value === 'month') {
    drawerTitle.value = 'Monthly total members';
  } else {
    drawerTitle.value = 'Daily total members';
  }
};

const onExport = async ({ count }) => {
  try {
    await doExport({
      selected: false,
      customFilter: TOTAL_MEMBERS_FILTER({
        date: drawerDate.value,
        granularity: granularity.value,
        selectedPlatforms: props.filters.platform.value,
        selectedHasTeamMembers: props.filters.teamMembers,
      }),
      count,
    });
  } catch (error) {
    console.error(error);
  }
};
</script>

<style lang="scss" scoped>
.widget-total-members {
  @apply bg-white shadow rounded-lg p-6;
  :deep(.chart) {
    div {
      line-height: 100px !important;
      height: auto !important;
    }
    .cube-widget-chart {
      padding: 0;
      min-height: 0;
    }
    canvas {
      height: 100px;
    }
  }
}
</style>
