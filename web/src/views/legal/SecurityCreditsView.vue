<script setup lang="ts">
/**
 * 安全致谢（公开页）。
 *
 * 意图（Why）：
 *   公开致谢 responsibly disclosed 漏洞的发现者，是安全社区的标准做法：
 *   1) 对发现者表达尊重与感谢（他们是帮我们堵漏的人，不是敌人）；
 *   2) 向外界传递"本站认真对待安全、欢迎负责任披露"的信号，
 *      引导后来者走报告渠道而不是直接利用。
 *
 * 流转（Flow）：
 *   页脚 / 用户协议的"安全漏洞报告"入口 → /security；提交渠道走 contactEmail。
 *
 * 扩展（Extend）：
 *   新增致谢条目：在 hallOfFame 数组里追加一行即可（保持时间倒序）。
 *   收录标准：经站方验证属实、且以负责任方式先报告后公开的漏洞。
 *   上墙内容仅网名 + 日期 + 贡献概述，绝不记录漏洞细节、账号或利用过程。
 */
import { onMounted } from 'vue'

import LegalDocLayout from '@/components/LegalDocLayout.vue'
import { useSiteStore } from '@/stores/site'

const site = useSiteStore()

/** 安全致谢名录：时间倒序，只记录网名、日期与贡献概述。 */
interface Credit {
  name: string
  date: string
  contribution: string
  link?: string
}

const hallOfFame: Credit[] = [
  {
    name: '战争机器',
    date: '2026-09-28',
    contribution: '报告在线支付回调接口的签名重放漏洞（严重级别，可导致任意金额虚假入账）。',
  },
]
</script>

<template>
  <LegalDocLayout
    title="安全致谢"
    description="向负责任地报告安全漏洞的研究者致谢，并说明漏洞报告渠道。"
    updated-at="2026-09-28"
  >
    <section>
      <h2 class="section-title">一、致谢名录</h2>
      <p>
        以下研究者以负责任的方式向我们报告了安全漏洞（先报告、给予修复时间、不公开利用细节），
        我们在此公开致谢。排序按报告时间倒序。
      </p>

      <div class="mt-4 space-y-3">
        <div
          v-for="credit in hallOfFame"
          :key="credit.name + credit.date"
          class="card flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3"
        >
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-700 ring-1 ring-inset ring-brand-500/20">
            <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <path d="M12 15a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M8.5 13.5 7 22l5-3 5 3-1.5-8.5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>
          <span class="min-w-0">
            <span class="block text-sm font-semibold text-ink-50">{{ credit.name }}</span>
            <span class="block text-xs leading-relaxed text-ink-400">{{ credit.contribution }}</span>
          </span>
          <span class="ml-auto shrink-0 text-xs tabular-nums text-ink-500">{{ credit.date }}</span>
        </div>
      </div>
    </section>

    <section>
      <h2 class="section-title">二、如何报告安全漏洞</h2>
      <p v-if="site.contactEmail">
        若你发现了本站的安全漏洞，请发送邮件至
        <a :href="`mailto:${site.contactEmail}`" class="text-brand-700 hover:underline">{{ site.contactEmail }}</a>
        ，并在标题注明「安全漏洞报告」。
      </p>
      <p v-else>若你发现了本站的安全漏洞，请通过交流群联系管理员私下报告。</p>
      <ul class="list-disc space-y-1.5 pl-5">
        <li>描述漏洞类型、受影响的页面或接口、复现步骤（越详细越好）；</li>
        <li>请不要利用漏洞获取数据、篡改数据或影响服务可用性；</li>
        <li>请不要在修复完成前公开漏洞细节。</li>
      </ul>
    </section>

    <section>
      <h2 class="section-title">三、我们的承诺</h2>
      <ul class="list-disc space-y-1.5 pl-5">
        <li>收到报告后尽快确认（通常 72 小时内回复）；</li>
        <li>确认后按严重程度尽快修复，并及时向报告者同步进展；</li>
        <li>修复完成后，经报告者同意在「致谢名录」公开致谢；</li>
        <li>
          对善意报告者，我们不会追究其测试行为的安全责任（前提是遵守上面的报告准则）。
        </li>
      </ul>
    </section>

    <section>
      <h2 class="section-title">四、边界声明</h2>
      <p>
        本页致谢仅代表站方对「负责任披露」行为的感谢，不构成对任何测试行为的授权。
        未经授权对生产环境进行测试、扫描或攻击造成损害的，我们保留依法追究的权利。
      </p>
    </section>
  </LegalDocLayout>
</template>
