<script setup lang="ts">
/**
 * 联系方式（公开页）。
 *
 * 意图（Why）：
 *   经营性服务必须公示有效的联系方式——这是支付通道、浏览器与监管核查时
 *   最常检查的一项。本页把"找谁、通过什么渠道"集中展示，避免用户只能靠猜。
 *
 *   展示规则：能读到配置的项才显示（主体名称、客服邮箱来自 /api/status），
 *   没配置的一律不显示空标签；交流群入口在"加入交流群"页，此处只做跳转。
 *
 * 流转（Flow）：
 *   页脚「联系方式」/ 协议中的联系条款 → /contact
 *
 * 扩展（Extend）：
 *   新增联系渠道（如工单系统）时，在下方渠道列表补充一项即可。
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
    title="联系方式"
    description="如对服务、账单、退款或内容有任何疑问，请通过以下渠道与我们联系。"
    updated-at="2026-09-27"
  >
    <section>
      <h2 class="section-title">一、服务提供方</h2>
      <ul class="list-disc space-y-1.5 pl-5">
        <li v-if="site.operatorName">经营主体：{{ site.operatorName }}</li>
        <li v-if="site.icpLicense">ICP 备案号：{{ site.icpLicense }}</li>
        <li v-if="site.policeLicense">公安备案号：{{ site.policeLicense }}</li>
        <li>服务名称：{{ site.siteName }}</li>
      </ul>
    </section>

    <section>
      <h2 class="section-title">二、客服邮箱</h2>
      <p v-if="site.contactEmail">
        客服邮箱：
        <a :href="`mailto:${site.contactEmail}`" class="text-brand-700 hover:underline">
          {{ site.contactEmail }}
        </a>
        <br />
        我们通常会在数个工作日内回复。为便于定位问题，请在邮件中尽量说明账号、订单号与问题描述。
      </p>
      <p v-else>
        客服邮箱暂未在本页展示，请通过站内公告或交流群联系管理员。
      </p>
    </section>

    <section>
      <h2 class="section-title">三、交流群</h2>
      <p>
        使用问题与经验交流可加入我们的交流群：
        <RouterLink to="/join" class="text-brand-700 hover:underline">加入交流群</RouterLink>。
      </p>
    </section>

    <section>
      <h2 class="section-title">四、投诉与举报</h2>
      <p>
        如需投诉违规使用或举报违法内容，请见
        <RouterLink to="/report" class="text-brand-700 hover:underline">投诉举报</RouterLink>页。
      </p>
    </section>
  </LegalDocLayout>
</template>
