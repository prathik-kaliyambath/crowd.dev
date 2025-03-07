<template>
  <div
    class="filter-type-number filter-with-operator-and-input"
  >
    <app-inline-select-input
      v-if="defaultOperator !== 'between'"
      v-model="operator"
      popper-placement="bottom-start"
      prefix="Number:"
      class="mb-2"
      :options="computedOperatorOptions"
    />
    <div class="flex -mx-1 gap-2">
      <el-input
        ref="inputRef"
        v-model="model"
        type="number"
        :placeholder="
          operator === 'between' ? 'From' : 'Enter a value'
        "
        :disabled="
          operator === 'is_empty'
            || operator === 'is_not_empty'
        "
      />
      <el-input
        v-if="operator === 'between'"
        v-model="rangeModel"
        type="number"
        placeholder="To"
        :disabled="
          operator === 'is_empty'
            || operator === 'is_not_empty'
        "
      />
    </div>
  </div>
</template>

<script setup>
import {
  computed,
  defineEmits,
  defineProps,
  watch,
  ref,
} from 'vue';
import operators from '@/shared/filter/helpers/operators';

const props = defineProps({
  value: {
    type: [Array, Number],
    default: null,
  },
  defaultOperator: {
    type: String,
    default: null,
  },
  operator: {
    type: String,
    default: null,
  },
  isExpanded: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits([
  'update:value',
  'update:operator',
]);

const operator = computed({
  get() {
    return props.operator;
  },
  set(v) {
    emit('update:operator', v);
  },
});

const model = computed({
  get() {
    if (operator.value === 'between') {
      return Array.isArray(props.value)
        ? props.value[0]
        : props.value;
    }
    return props.value;
  },
  set(v) {
    emit(
      'update:value',
      operator.value === 'between'
        ? [Number(v), Number(props.value[1])]
        : Number(v),
    );
  },
});

const rangeModel = computed({
  get() {
    return props.value[1];
  },
  set(v) {
    emit('update:value', [Number(model.value), Number(v)]);
  },
});

const computedOperatorOptions = computed(() => Object.keys(operators.number.operator).map((o) => ({
  value: o,
  label: operators.number.operator[o],
})));
const expanded = computed(() => props.isExpanded);
const inputRef = ref(null);

watch(expanded, async (newValue) => {
  if (newValue) {
    inputRef.value.focus();
  }
});
</script>

<script>
export default {
  name: 'AppFilterTypeNumber',
};
</script>

<style lang="scss">
.filter-type-number {
  input[type='number']::-webkit-inner-spin-button,
  input[type='number']::-webkit-outer-spin-button {
    -webkit-appearance: none;
    appearance: none;
    margin: 0;
  }
}
</style>
