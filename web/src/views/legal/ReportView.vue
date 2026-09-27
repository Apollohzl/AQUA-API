<script setup lang="ts">
/**
 * 投诉举报（公开页）。
 *
 * 意图（Why）：
 *   提供 AI 生成内容服务的站点，需要公示"发现违法和不良信息时向谁举报、怎么举报"，
 *   这是内容安全治理的基本要求，也是用户与监管最直接可用的一个抓手。
 *   本页把举报范围、所需材料与处理承诺写清楚，让举报真正可执行。
 *
 * 流转（Flow）：
 *   页脚「投诉举报」/ 协议与联系方式页的跳转 → /report；实际提交走客服邮箱。
 *
 * 扩展（Extend）：
 *   若后续接入在线举报表单，在此页替换/增加入口即可，文本口径保持不变。
 */
import { onMounted } from 'vue'

import LegalDocLayout from '@/components/LegalDocLayout.vue'
import { useSiteStore } from '@/stores/site'

const site = useSiteStore()

onMounted(() => {
  void site.load()
})
</script>

<template>
  <LegalDocLayout
    title="投诉举报"
    description="发现违法和不良信息或违规使用行为，请通过以下方式向我们举报。"
    updated-at="2026-09-27"
  >
    <section>
      <h2 class="section-title">一、可以举报的情形</h2>
      <ul class="list-disc space-y-1.5 pl-5">
        <li>利用本服务生成、传播违反法律法规的内容；</li>
        <li>利用本服务从事诈骗、赌博、色情、暴力、制售违禁品等违法活动；</li>
        <li>攻击、扫描、爆破、批量注册、刷单或牟利性转售等违规使用；</li>
        <li>侵犯他人知识产权、名誉权、隐私权等合法权益的行为。</li>
      </ul>
    </section>

    <section>
      <h2 class="section-title">二、如何举报</h2>
      <p v-if="site.contactEmail">
        请发送邮件至
        <a :href="`mailto:${site.contactEmail}`" class="text-brand-700 hover:underline">
          {{ site.contactEmail }}
        </a>
        ，并在邮件中尽量提供以下信息，以便我们快速核实：
      </p>
      <p v-else>
        请通过站内公告或交流群联系管理员提交举报，并提供以下信息以便我们快速核实：
      </p>
      <ul class="list-disc space-y-1.5 pl-5">
        <li>被举报的具体内容或行为描述（截图、链接、时间等）；</li>
        <li>涉及的账号、模型或订单信息（如可获取）；</li>
        <li>你的联系方式（便于必要时回访核实）。</li>
      </ul>
    </section>

    <section>
      <h2 class="section-title">三、处理承诺</h2>
      <ul class="list-disc space-y-1.5 pl-5">
        <li>我们在收到举报后尽快核实，情况属实的将限制或终止相关账号的服务，并保留处理记录；</li>
        <li>对涉嫌违法犯罪的内容，我们将依法向主管部门报告；</li>
        <li>请如实举报，恶意举报或诬告可能被追究相应责任。</li>
      </ul>
    </section>

    <section>
      <h2 class="section-title">四、其他渠道</h2>
      <p>
        服务与账单相关问题请见
        <RouterLink to="/contact" class="text-brand-700 hover:underline">联系方式</RouterLink>页；
        使用交流可加入
        <RouterLink to="/join" class="text-brand-700 hover:underline">交流群</RouterLink>。
      </p>
    </section>
  </LegalDocLayout>
</template>
