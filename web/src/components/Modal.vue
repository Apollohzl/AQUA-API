<script setup lang="ts">
/**
 * 通用弹窗（Modal）。
 *
 * 意图（Why）：
 *   新建/编辑/一次性密钥展示等场景都需要「聚焦的浮层」；
 *   统一实现遮罩、ESC 关闭、滚动锁定与动画，避免各页面重复处理这些细节。
 *
 *   ESC 关闭、Tab 焦点陷阱、body 滚动锁与「关闭后焦点归还触发按钮」
 *   统一由 composables/useDialogA11y.ts 提供 —— 与 Drawer 共用一套实现，
 *   这样浮层叠浮层时滚动锁不会互相打断（详见该文件的意图说明）。
 *
 * 流转（Flow）：
 *   页面 v-model:open → Teleport 到 body → 内部插槽渲染内容 / footer 插槽渲染按钮
 *
 * 扩展（Extend）：
 *   需要更宽的表单请传 width="max-w-2xl"；
 *   表单类弹窗建议 closeOnBackdrop=false，避免误点遮罩丢失输入。
 */
import { ref } from 'vue'

import AppIcon from './AppIcon.vue'
import { useDialogA11y } from '@/composables/useDialogA11y'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    /** 标题下的补充说明（建议写清影响范围） */
    subtitle?: string
    /** 面板最大宽度类名 */
    width?: string
    /** 是否允许点击遮罩关闭 */
    closeOnBackdrop?: boolean
    /** 是否显示右上角关闭按钮（一次性密钥弹窗建议保留） */
    showClose?: boolean
  }>(),
  { width: 'max-w-lg', closeOnBackdrop: true, showClose: true },
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
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto overscroll-contain sm:items-start sm:p-6"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
      >
        <div
          class="fixed inset-0 bg-ink-50/35 backdrop-blur-[2px]"
          @click="closeOnBackdrop && emit('close')"
        />

        <!--
          窄屏改为「底部弹出式」：面板贴底、只保留上方圆角、限高并可纵向滚动。
          为什么这么改：手机屏幕本就窄，居中弹窗会把上下内容压扁，且确认/关闭按钮
          离拇指很远；贴底后主操作落在拇指区，长表单也能在 85vh 内顺畅滚动。
          桌面端（sm 起）恢复居中卡片形态，保持后台一贯观感。
          env(safe-area-inset-bottom) 让底部按钮避开 iPhone 的 Home 指示条（桌面为 0）。
        -->
        <div
          ref="panelRef"
          tabindex="-1"
          class="relative z-10 flex max-h-[85vh] w-full flex-col overflow-y-auto rounded-t-2xl border border-ink-700
            bg-ink-900 shadow-pop outline-none sm:my-6 sm:max-h-[calc(100vh-3rem)] sm:rounded-2xl"
          :class="width"
          style="padding-bottom: env(safe-area-inset-bottom)"
        >
          <header class="flex items-start justify-between gap-4 border-b border-ink-700 px-5 py-4">
            <div class="min-w-0">
              <h2 class="text-base font-semibold text-ink-50">{{ title }}</h2>
              <p v-if="subtitle" class="mt-1 text-xs leading-relaxed text-ink-400">{{ subtitle }}</p>
            </div>
            <button
              v-if="showClose"
              type="button"
              class="btn btn-ghost btn-icon -me-1.5 -mt-0.5"
              :aria-label="$t('components.modal.close')"
              @click="emit('close')"
            >
              <AppIcon name="close" :size="18" />
            </button>
          </header>

          <div class="px-5 py-4">
            <slot />
          </div>

          <footer v-if="$slots.footer" class="flex flex-wrap items-center justify-end gap-2 border-t border-ink-700 px-5 py-4">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
