<script setup lang="ts">
/**
 * 隐私政策（公开页）。
 *
 * 意图（Why）：
 *   个人信息的收集必须"告知—同意"，这是《个人信息保护法》的硬性要求，
 *   也是邮箱验证码注册场景下最容易被投诉缺失的一环。本页把三件事写清楚：
 *     1) 我们收集什么（账号信息、调用记录）——不多收集；
 *     2) 用来做什么、保存多久；
 *     3) 用户怎么更正或删除（注销路径）。
 *
 * 流转（Flow）：
 *   页脚「隐私政策」/ 注册页勾选文案 → /privacy；注销与数据请求走「联系方式」页。
 *
 * 扩展（Extend）：
 *   数据留存期、第三方共享范围若有调整，务必同步更新正文并改"更新日期"。
 */
import LegalDocLayout from '@/components/LegalDocLayout.vue'
</script>

<template>
  <LegalDocLayout
    title="隐私政策"
    description="本政策说明我们在你使用本站服务时收集哪些信息、如何使用与保护这些信息，以及你享有的权利。"
    updated-at="2026-09-27"
  >
    <section>
      <h2 class="section-title">一、我们收集的信息</h2>
      <p>为提供接口接入服务，我们仅收集与提供服务直接相关的信息：</p>
      <ul class="list-disc space-y-1.5 pl-5">
        <li><strong>账号信息</strong>：注册邮箱、用户名、密码（以不可逆的方式加密存储）、注册时间。</li>
        <li><strong>调用记录</strong>：调用时间、所用模型、输入/输出用量与扣费金额。</li>
        <li><strong>充值记录</strong>：充值订单号、金额、支付状态与时间。</li>
        <li><strong>必要的技术信息</strong>：用于安全防护的登录时间与来源等基础信息。</li>
      </ul>
      <p>
        我们<strong>不主动读取</strong>你通过接口提交的对话内容用于其他目的；
        为履行内容安全义务，请求内容会被必要的合规过滤规则校验。
      </p>
    </section>

    <section>
      <h2 class="section-title">二、信息的使用</h2>
      <ul class="list-disc space-y-1.5 pl-5">
        <li>提供、维护与改进服务，包括计费、对账与用量统计。</li>
        <li>身份验证与账号安全，例如登录校验与异常行为识别。</li>
        <li>履行法律法规要求，例如内容安全与必要的记录留存。</li>
        <li>在你同意的前提下，向你发送与服务相关的通知（如余额、公告）。</li>
      </ul>
      <p>我们不会将你的个人信息用于上述目的之外的用途。</p>
    </section>

    <section>
      <h2 class="section-title">三、信息的共享</h2>
      <ul class="list-disc space-y-1.5 pl-5">
        <li>我们不会向第三方出售、出租你的个人信息。</li>
        <li>为完成支付，充值相关的必要信息会提供给对应的支付服务方。</li>
        <li>根据法律法规、司法或行政机关的合法要求，我们可能依法提供必要信息。</li>
      </ul>
    </section>

    <section>
      <h2 class="section-title">四、信息的保存与保护</h2>
      <ul class="list-disc space-y-1.5 pl-5">
        <li>账号与调用记录保存在本站服务器，保存期限为实现本政策所述目的所必需的期间。</li>
        <li>密码以不可逆方式加密存储；令牌可随时在控制台重置或删除。</li>
        <li>我们采取访问控制等措施保护数据，但请注意互联网传输无法保证绝对安全。</li>
      </ul>
    </section>

    <section>
      <h2 class="section-title">五、你的权利</h2>
      <ul class="list-disc space-y-1.5 pl-5">
        <li>你可以查询、更正账号中的邮箱等信息。</li>
        <li>你可以随时重置或删除访问令牌，停止产生调用记录。</li>
        <li>如需注销账号或删除相关数据，请通过「联系方式」页提出，我们在核实身份后处理。</li>
      </ul>
    </section>

    <section>
      <h2 class="section-title">六、未成年人</h2>
      <p>
        本服务面向具备完全民事行为能力的开发者与使用者。若你未满 18 周岁，
        请在监护人陪同下阅读本政策，并在取得监护人同意后使用本服务。
      </p>
    </section>

    <section>
      <h2 class="section-title">七、政策更新与联系我们</h2>
      <p>
        本政策可能随业务与法规要求更新，更新后在本页公示并标注更新日期。
        对本政策有任何疑问或请求，请通过
        <RouterLink to="/contact" class="text-brand-700 hover:underline">联系方式</RouterLink>
        页与我们联系。
      </p>
    </section>
  </LegalDocLayout>
</template>
