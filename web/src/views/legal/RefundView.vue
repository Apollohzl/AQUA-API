<script setup lang="ts">
/**
 * 充值退款规则（公开页）。
 *
 * 意图（Why）：
 *   充值属于预付款消费，必须事前把"能不能退、怎么退、多久到账"讲清楚，
 *   否则既容易产生纠纷，也可能被支付通道或监管认定为未公示交易规则。
 *   本页把退款的关键口径显式写出来：
 *     1) 未消费金额可退，已消费金额按实际用量结算；
 *     2) 申请渠道与所需信息；
 *     3) 到账时间与特殊情形（如充值赠送部分）。
 *
 * 流转（Flow）：
 *   页脚「充值退款」/ 充值页 → /refund；申请退款走「联系方式」页提交。
 *
 * 扩展（Extend）：
 *   若调整退款手续费或到账时效，务必同步更新本页与充值页的提示文案。
 */
import LegalDocLayout from '@/components/LegalDocLayout.vue'
</script>

<template>
  <LegalDocLayout
    title="充值退款规则"
    description="本规则说明账户充值的结算方式、可退款范围与申请流程。"
    updated-at="2026-09-27"
  >
    <section>
      <h2 class="section-title">一、充值与结算</h2>
      <ul class="list-disc space-y-1.5 pl-5">
        <li>充值金额以人民币结算，充入账户后用于按用量抵扣模型调用费用。</li>
        <li>模型单价以「模型广场」公示的报价为准；每次调用的用量与扣费可在「调用日志」中逐笔核对。</li>
        <li>账户余额为预付性质，仅可用于本站服务消费，不可转让、提现或用于其他用途。</li>
      </ul>
    </section>

    <section>
      <h2 class="section-title">二、可退款范围</h2>
      <ul class="list-disc space-y-1.5 pl-5">
        <li><strong>未消费金额</strong>：账户中尚未用于调用消费的充值金额，可申请退款。</li>
        <li><strong>已消费金额</strong>：已通过调用消耗的金额按实际用量结算，不予退款。</li>
        <li>
          因充值活动获赠的金额、优惠或代金券等非实付部分，不参与退款；
          退款时仅退实际支付金额对应的未消费部分。
        </li>
        <li>因本站原因导致的服务长期不可用，我们将按实际情况协商处理。</li>
      </ul>
    </section>

    <section>
      <h2 class="section-title">三、如何申请</h2>
      <p>如需退款，请通过「联系方式」页提供的邮箱提交申请，并尽量包含以下信息：</p>
      <ul class="list-disc space-y-1.5 pl-5">
        <li>注册邮箱或用户名；</li>
        <li>充值订单号与充值时间（可在「财务记录」中查询）；</li>
        <li>退款原因与拟退款金额。</li>
      </ul>
      <p>为保障账户安全，我们可能要求你完成必要的身份核实后再处理。</p>
    </section>

    <section>
      <h2 class="section-title">四、处理时效与方式</h2>
      <ul class="list-disc space-y-1.5 pl-5">
        <li>我们在收到并核实申请后<strong>尽快处理</strong>，退款将退回原支付渠道。</li>
        <li>到账时间以支付渠道的实际处理时间为准，通常为数个工作日。</li>
        <li>退款完成后，对应的账户余额将相应扣减，相关调用记录仍依法保留。</li>
      </ul>
    </section>

    <section>
      <h2 class="section-title">五、不予退款的情形</h2>
      <ul class="list-disc space-y-1.5 pl-5">
        <li>账号因违反《用户协议》（如违法用途、攻击、批量注册、牟利性转售）被限制或终止的；</li>
        <li>已消费金额；</li>
        <li>赠送、返利等非实付部分。</li>
      </ul>
    </section>

    <section>
      <h2 class="section-title">六、联系我们</h2>
      <p>
        对退款规则或处理进度有疑问，请通过
        <RouterLink to="/contact" class="text-brand-700 hover:underline">联系方式</RouterLink>
        页与我们联系。
      </p>
    </section>
  </LegalDocLayout>
</template>
