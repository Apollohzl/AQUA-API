// 敏感词匹配器的测试。
//
// 测试重点（为什么测这些）：
//   - 命中/未命中：匹配器是"拦截"决策的唯一依据，漏报等于过滤形同虚设；
//   - 大小写不敏感：英文脏词常以各种大小写出现，区分大小写必然漏配；
//   - 重叠与后缀命中：Aho–Corasick 的失败指针写错时，典型症状正是
//     "只有某些排列组合能命中"，这类 bug 在人工点点点中极难发现；
//   - 空词与停用词：空词会让每个请求都命中（等于拦全站），必须被跳过。
package model

import "testing"

func TestSensitiveMatcher_命中与未命中(t *testing.T) {
	matcher := NewSensitiveMatcher([]*SensitiveWord{
		{ID: 1, Word: "赌博", Enabled: true},
		{ID: 2, Word: "毒品", Enabled: true},
	})

	cases := []struct {
		name string
		text string
		want bool
	}{
		{"直接命中", "哪里可以赌博", true},
		{"命中第二条", "毒品交易", true},
		{"未命中", "今天天气不错", false},
		{"空文本", "", false},
		{"英文无关文本", "hello world", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, got := matcher.Match(tc.text)
			if got != tc.want {
				t.Fatalf("Match(%q) = %v，期望 %v", tc.text, got, tc.want)
			}
		})
	}
}

func TestSensitiveMatcher_大小写不敏感(t *testing.T) {
	matcher := NewSensitiveMatcher([]*SensitiveWord{
		{ID: 1, Word: "badword", Enabled: true},
	})

	for _, text := range []string{"badword", "BadWord", "BADWORD", "xxBADWORDyy"} {
		if _, ok := matcher.Match(text); !ok {
			t.Fatalf("应命中（大小写不敏感）：%q", text)
		}
	}
}

func TestSensitiveMatcher_词条中的大写也能命中(t *testing.T) {
	// 站长把词条写成大写时，小写正文同样应当命中
	matcher := NewSensitiveMatcher([]*SensitiveWord{
		{ID: 1, Word: "BadWord", Enabled: true},
	})
	if _, ok := matcher.Match("this is a badword here"); !ok {
		t.Fatalf("词条含大写时应按小写匹配")
	}
}

func TestSensitiveMatcher_重叠与后缀命中(t *testing.T) {
	// 这些词的公共后缀/前缀用于验证失败指针：
	//   "ab" 与 "bc"：文本 "abc" 应在扫描到 'b' 前的 'a'…'b' 命中 ab；
	//   "cde"：文本 "abcde" 需要从 "ab" 的失败路径继续走到 cde。
	matcher := NewSensitiveMatcher([]*SensitiveWord{
		{ID: 1, Word: "ab", Enabled: true},
		{ID: 2, Word: "bc", Enabled: true},
		{ID: 3, Word: "cde", Enabled: true},
	})

	cases := map[string]bool{
		"ab":    true,
		"bc":    true,
		"abc":   true, // 命中 ab 或 bc 均可
		"abcde": true, // cde 需要通过失败路径命中
		"xyz":   false,
	}

	for text, want := range cases {
		if _, got := matcher.Match(text); got != want {
			t.Fatalf("Match(%q) = %v，期望 %v（失败指针可能写错）", text, got, want)
		}
	}
}

func TestSensitiveMatcher_跳过长词与停用词(t *testing.T) {
	matcher := NewSensitiveMatcher([]*SensitiveWord{
		{ID: 1, Word: "", Enabled: true},     // 空词：必须跳过，否则命中一切
		{ID: 2, Word: "   ", Enabled: true},  // 纯空白：同样必须跳过
		{ID: 3, Word: "停用词", Enabled: false}, // 停用：不参与匹配
		{ID: 4, Word: "生效词", Enabled: true},  // 正常词
	})

	if matcher.Count() != 1 {
		t.Fatalf("只有 1 条有效词条，实际编译了 %d 条", matcher.Count())
	}
	if _, ok := matcher.Match("随便什么内容"); ok {
		t.Fatalf("空词/空白词不得命中任何文本")
	}
	if _, ok := matcher.Match("含停用词的内容"); ok {
		t.Fatalf("停用词不应参与匹配")
	}
	if hit, ok := matcher.Match("含生效词的内容"); !ok || hit.ID != 4 {
		t.Fatalf("应命中 ID=4 的词条，实际 %+v", hit)
	}
}

func TestSensitiveMatcher_空匹配器与nil(t *testing.T) {
	empty := NewSensitiveMatcher(nil)
	if !empty.Empty() {
		t.Fatalf("无词条时 Empty 应为 true")
	}
	if _, ok := empty.Match("任意文本"); ok {
		t.Fatalf("空匹配器不应命中")
	}

	var nilMatcher *SensitiveMatcher
	if !nilMatcher.Empty() {
		t.Fatalf("nil 匹配器 Empty 应为 true")
	}
	if _, ok := nilMatcher.Match("任意文本"); ok {
		t.Fatalf("nil 匹配器不应 panic，也不应命中")
	}
}

func TestSensitiveWord_MatchKey(t *testing.T) {
	cases := map[string]string{
		"  BadWord ": "badword",
		"赌博":         "赌博",
		"":           "",
	}
	for input, want := range cases {
		word := &SensitiveWord{Word: input}
		if got := word.MatchKey(); got != want {
			t.Fatalf("MatchKey(%q) = %q，期望 %q", input, got, want)
		}
	}
}

func TestSensitiveWord_Validate(t *testing.T) {
	if err := (&SensitiveWord{Word: "正常词"}).Validate(); err != nil {
		t.Fatalf("合法词条不应报错: %v", err)
	}
	if err := (&SensitiveWord{Word: "   "}).Validate(); err == nil {
		t.Fatalf("空词条应报错")
	}
	if err := (&SensitiveWord{Word: string(make([]rune, MaxSensitiveWordRunes+1))}).Validate(); err == nil {
		t.Fatalf("超长词条应报错")
	}
}
