<script setup lang="ts">
/**
 * 右侧抽屉（Drawer）：用于渠道新建/编辑这类字段较多的表单。
 *
 * 意图（Why）：
 *   渠道表单有 9 个字段，用居中弹窗会把背景页完全遮住，用户在填表时看不到列表上下文；
 *   抽屉从右侧滑出、保留左侧列表可见，适合「边看列表边改配置」的场景。
 *
 *   ESC 关闭、Tab 焦点陷阱、body 滚动锁与「关闭后焦点归还」交给
 *   composables/useDialogA11y.ts（与 Modal 共用），
 *   这样「抽屉里再开一个抽屉」时不会出现"关掉上层、下层还在但背景已能滚动"。
 *
 * 流转（Flow）：
 *   ChannelsView（open 状态）→ Teleport 到 body → 右侧面板 → footer 插槽放「保存/取消」
 *
 * 扩展（Extend）：
 *   需要更宽的表单请传 width="max-w-2xl"。
 */
import { ref } from 'vue'

import AppIcon from './AppIcon.vue'
import { useDialogA11y } from '@/composables/useDialogA11y'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    subtitle?: string
    /** 面板宽度类名 */
    width?: string
    /** 是否允许点击遮罩关闭 */
    closeOnBackdrop?: boolean
  }>(),
  { width: 'max-w-xl', closeOnBackdrop: true },
)

const emit = defineEmits<{ (e: 'close'): void }>()

/** 面板元素：焦点陷阱与初始焦点的落点 */
const panelRef = ref<HTMLElement | null>(null)

useDialogA11y({
  open: () => props.open,
  panel: panelRef,
  onEscape: () => emit('close'),
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50" role="dialog" aria-modal="true" :aria-label="title">
      <div
        class="absolute inset-0 bg-ink-50/30 backdrop-blur-[2px] animate-fade-in"
        @click="closeOnBackdrop && emit('close')"
      />

      <aside
        ref="panelRef"
        tabindex="-1"
        class="drawer-panel absolute end-0 top-0 flex h-full w-full flex-col border-s border-ink-700 bg-ink-900 shadow-pop outline-none animate-slide-in-right"
        :class="width"
      >
        <header class="flex items-start justify-between gap-4 border-b border-ink-800 px-5 py-4">
          <div class="min-w-0">
            <h2 class="text-base font-semibold text-ink-50">{{ title }}</h2>
            <p v-if="subtitle" class="mt-1 text-xs leading-relaxed text-ink-400">{{ subtitle }}</p>
          </div>
          <button type="button" class="btn btn-ghost btn-icon -me-1.5" :aria-label="$t('components.drawer.close')" @click="emit('close')">
            <AppIcon name="close" :size="18" />
          </button>
        </header>

        <div class="flex-1 overflow-y-auto px-5 py-4">
          <slot />
        </div>

        <footer
          v-if="$slots.footer"
          class="flex flex-wrap items-center justify-end gap-2 border-t border-ink-800 bg-ink-900 px-5 py-4"
        >
          <slot name="footer" />
        </footer>
      </aside>
    </div>
  </Teleport>
</template>
